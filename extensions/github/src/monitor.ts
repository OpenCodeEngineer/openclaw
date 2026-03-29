import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig, RuntimeEnv } from "openclaw/plugin-sdk";
import {
  createDedupeCache,
  readRequestBodyWithLimit,
  registerWebhookTarget,
  rejectNonPostWebhookRequest,
  requestBodyErrorToText,
  resolveWebhookPath,
  resolveWebhookTargets,
  isRequestBodyLimitError,
} from "openclaw/plugin-sdk";
import type { ResolvedGitHubAccount } from "./accounts.js";
import { handleGitHubInbound, parseGitHubInboundEvent } from "./inbound.js";
import { isRepositoryAllowedByConfig } from "./policy.js";
import { getGitHubRuntime } from "./runtime.js";
import { extractGitHubWebhookHeaders, verifyGitHubWebhookSignature } from "./signature.js";

export type GitHubMonitorOptions = {
  account: ResolvedGitHubAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  abortSignal: AbortSignal;
  webhookPath?: string;
  webhookUrl?: string;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

type GitHubCoreRuntime = ReturnType<typeof getGitHubRuntime>;

type WebhookTarget = {
  account: ResolvedGitHubAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  core: GitHubCoreRuntime;
  path: string;
  webhookSecret: string;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

const webhookTargets = new Map<string, WebhookTarget[]>();
const dedupeByAccount = new Map<string, ReturnType<typeof createDedupeCache>>();

function getDeliveryDedupeCache(accountId: string) {
  const existing = dedupeByAccount.get(accountId);
  if (existing) {
    return existing;
  }
  const next = createDedupeCache({
    ttlMs: 10 * 60 * 1000,
    maxSize: 5000,
  });
  dedupeByAccount.set(accountId, next);
  return next;
}

export function registerGitHubWebhookTarget(target: WebhookTarget): () => void {
  return registerWebhookTarget(webhookTargets, target).unregister;
}

function parsePayload(rawBody: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function resolveRepositoryFromPayload(payload: Record<string, unknown>): string | null {
  const repository =
    payload.repository &&
    typeof payload.repository === "object" &&
    !Array.isArray(payload.repository)
      ? (payload.repository as Record<string, unknown>)
      : null;
  const fullName = repository?.full_name;
  if (typeof fullName !== "string" || !fullName.trim()) {
    return null;
  }
  return fullName.trim().toLowerCase();
}

function targetMatchesSignature(
  target: WebhookTarget,
  rawBody: string,
  signatureHeader?: string,
): boolean {
  if (target.webhookSecret.trim()) {
    return verifyGitHubWebhookSignature({
      secret: target.webhookSecret,
      body: rawBody,
      signature256: signatureHeader,
    });
  }
  return !signatureHeader;
}

function isEventEnabled(target: WebhookTarget, eventName: string): boolean {
  const events = target.account.config.events;
  if (!events) {
    return true;
  }
  if (eventName === "issue_comment") {
    return events.issueComment !== false;
  }
  if (eventName === "pull_request_review_comment") {
    return events.pullRequestReviewComment !== false;
  }
  if (eventName === "pull_request_review") {
    return events.pullRequestReview !== false;
  }
  return true;
}

function handleRequestBodyError(error: unknown, res: ServerResponse): void {
  if (isRequestBodyLimitError(error, "PAYLOAD_TOO_LARGE")) {
    res.statusCode = 413;
    res.end(requestBodyErrorToText("PAYLOAD_TOO_LARGE"));
    return;
  }
  if (isRequestBodyLimitError(error, "REQUEST_BODY_TIMEOUT")) {
    res.statusCode = 408;
    res.end(requestBodyErrorToText("REQUEST_BODY_TIMEOUT"));
    return;
  }
  res.statusCode = 400;
  res.end("invalid request body");
}

export async function handleGitHubWebhookRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const resolved = resolveWebhookTargets(req, webhookTargets);
  if (!resolved) {
    return false;
  }
  const { targets } = resolved;
  if (rejectNonPostWebhookRequest(req, res)) {
    return true;
  }

  let rawBody = "";
  try {
    rawBody = await readRequestBodyWithLimit(req, {
      maxBytes: 1024 * 1024,
      timeoutMs: 30_000,
    });
  } catch (error) {
    handleRequestBodyError(error, res);
    return true;
  }

  const payload = parsePayload(rawBody);
  if (!payload) {
    res.statusCode = 400;
    res.end("invalid payload");
    return true;
  }

  const headers = extractGitHubWebhookHeaders(
    req.headers as Record<string, string | string[] | undefined>,
  );
  const eventName = headers.event?.trim();
  if (!eventName) {
    res.statusCode = 400;
    res.end("missing event header");
    return true;
  }

  const repoFullName = resolveRepositoryFromPayload(payload);
  const repoCandidates = targets.filter((target) => {
    if (!repoFullName) {
      return true;
    }
    return isRepositoryAllowedByConfig({
      config: target.account.config,
      repoFullName,
    });
  });
  if (repoCandidates.length === 0) {
    res.statusCode = 403;
    res.end("repository not allowed");
    return true;
  }

  const matchedTargets = repoCandidates.filter((target) =>
    targetMatchesSignature(target, rawBody, headers.signature256),
  );
  if (matchedTargets.length === 0) {
    res.statusCode = 401;
    res.end("unauthorized");
    return true;
  }
  if (matchedTargets.length > 1) {
    res.statusCode = 401;
    res.end("ambiguous webhook target");
    return true;
  }

  const selected = matchedTargets[0];
  const deliveryId = headers.deliveryId?.trim();
  if (deliveryId && getDeliveryDedupeCache(selected.account.accountId).check(deliveryId)) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end('{"ok":true,"duplicate":true}');
    return true;
  }

  if (eventName === "ping") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end('{"ok":true,"event":"ping"}');
    return true;
  }

  if (!isEventEnabled(selected, eventName)) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end('{"ok":true,"ignored":true}');
    return true;
  }

  const inboundEvent = parseGitHubInboundEvent(eventName, payload);
  if (!inboundEvent) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end('{"ok":true,"ignored":true}');
    return true;
  }

  selected.statusSink?.({ lastInboundAt: Date.now() });
  void handleGitHubInbound({
    event: inboundEvent,
    target: selected,
  }).catch((error) => {
    selected.runtime.error?.(
      `[${selected.account.accountId}] github webhook processing failed: ${String(error)}`,
    );
  });

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end('{"ok":true}');
  return true;
}

export function monitorGitHubProvider(options: GitHubMonitorOptions): () => void {
  const core = getGitHubRuntime();
  const webhookPath = resolveWebhookPath({
    webhookPath: options.webhookPath,
    webhookUrl: options.webhookUrl,
    defaultPath: "/github",
  });
  if (!webhookPath) {
    options.runtime.error?.(`[${options.account.accountId}] invalid webhook path`);
    return () => {};
  }
  return registerGitHubWebhookTarget({
    account: options.account,
    config: options.config,
    runtime: options.runtime,
    core,
    path: webhookPath,
    webhookSecret: options.account.webhookSecret,
    statusSink: options.statusSink,
  });
}

export async function startGitHubMonitor(params: GitHubMonitorOptions): Promise<() => void> {
  return monitorGitHubProvider(params);
}

export function resolveGitHubWebhookPath(params: { account: ResolvedGitHubAccount }): string {
  return (
    resolveWebhookPath({
      webhookPath: params.account.config.webhookPath,
      webhookUrl: params.account.config.webhookUrl,
      defaultPath: "/github",
    }) ?? "/github"
  );
}
