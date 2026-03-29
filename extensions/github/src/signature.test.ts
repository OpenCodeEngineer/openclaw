import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyGitHubWebhookSignature } from "./signature.js";

function makeSignature(secret: string, body: string): string {
  const digest = createHmac("sha256", secret).update(body, "utf-8").digest("hex");
  return `sha256=${digest}`;
}

describe("verifyGitHubWebhookSignature", () => {
  it("accepts a valid signature", () => {
    const secret = "super-secret";
    const body = JSON.stringify({ hello: "world" });
    expect(
      verifyGitHubWebhookSignature({
        secret,
        body,
        signature256: makeSignature(secret, body),
      }),
    ).toBe(true);
  });

  it("rejects signature mismatches", () => {
    const secret = "super-secret";
    const body = JSON.stringify({ hello: "world" });
    expect(
      verifyGitHubWebhookSignature({
        secret,
        body,
        signature256: makeSignature("other-secret", body),
      }),
    ).toBe(false);
  });

  it("rejects invalid signature format", () => {
    expect(
      verifyGitHubWebhookSignature({
        secret: "secret",
        body: "{}",
        signature256: "bad-signature",
      }),
    ).toBe(false);
  });
});
