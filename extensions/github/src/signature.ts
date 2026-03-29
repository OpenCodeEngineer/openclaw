import { createHmac, timingSafeEqual } from "node:crypto";

type HeaderValue = string | string[] | undefined;

function readHeader(headers: Record<string, HeaderValue>, key: string): string | undefined {
  const value = headers[key] ?? headers[key.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === "string" ? value : undefined;
}

export function extractGitHubWebhookHeaders(headers: Record<string, HeaderValue>): {
  event?: string;
  deliveryId?: string;
  signature256?: string;
} {
  return {
    event: readHeader(headers, "x-github-event"),
    deliveryId: readHeader(headers, "x-github-delivery"),
    signature256: readHeader(headers, "x-hub-signature-256"),
  };
}

export function verifyGitHubWebhookSignature(params: {
  secret: string;
  body: string;
  signature256?: string;
}): boolean {
  const secret = params.secret.trim();
  if (!secret) {
    return false;
  }
  const header = params.signature256?.trim();
  if (!header || !header.toLowerCase().startsWith("sha256=")) {
    return false;
  }
  const digest = header.slice("sha256=".length).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(digest)) {
    return false;
  }

  const expected = createHmac("sha256", secret).update(params.body, "utf-8").digest("hex");
  const providedBuffer = Buffer.from(digest, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(providedBuffer, expectedBuffer);
}
