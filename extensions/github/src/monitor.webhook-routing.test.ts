import { createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { createMockServerResponse } from "../../../src/test-utils/mock-http-response.js";
import type { ResolvedGitHubAccount } from "./accounts.js";
import { handleGitHubWebhookRequest, registerGitHubWebhookTarget } from "./monitor.js";

vi.mock("./inbound.js", () => ({
  parseGitHubInboundEvent: vi.fn((eventName: string, payload: unknown) => {
    const root = payload as { repository?: { full_name?: string }; issue?: { number?: number } };
    const repo = root.repository?.full_name ?? "openclaw/openclaw";
    const issueNumber = root.issue?.number ?? 1;
    return {
      eventName,
      sourceKind: "issue_comment",
      repoFullName: repo,
      issueNumber,
      actorLogin: "alice",
      actorId: "1",
      body: "test",
      commentId: 1,
      messageId: "issue-comment:1",
      threadTarget: `${repo}#${issueNumber}`,
    };
  }),
  handleGitHubInbound: vi.fn(async () => {}),
}));

function sign(secret: string, body: string): string {
  const digest = createHmac("sha256", secret).update(body, "utf-8").digest("hex");
  return `sha256=${digest}`;
}

function createWebhookRequest(params: {
  payload: unknown;
  path?: string;
  event?: string;
  signature?: string;
}): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage & {
    destroyed?: boolean;
    destroy: () => IncomingMessage;
  };
  req.method = "POST";
  req.url = params.path ?? "/github";
  req.headers = {
    "content-type": "application/json",
    "x-github-event": params.event ?? "issue_comment",
    "x-hub-signature-256": params.signature ?? "",
    "x-github-delivery": "delivery-1",
  };
  req.destroyed = false;
  req.destroy = () => {
    req.destroyed = true;
    return req;
  };
  const rawBody = JSON.stringify(params.payload);
  void Promise.resolve().then(() => {
    req.emit("data", Buffer.from(rawBody, "utf-8"));
    if (!req.destroyed) {
      req.emit("end");
    }
  });
  return req;
}

function account(
  accountId: string,
  overrides?: Partial<ResolvedGitHubAccount>,
): ResolvedGitHubAccount {
  return {
    accountId,
    enabled: true,
    token: "token",
    tokenSource: "config",
    webhookSecret: "secret",
    webhookSecretSource: "config",
    config: {
      webhookPath: "/github",
      requireMention: true,
    },
    ...overrides,
  };
}

const testRuntime = {
  log: () => {},
  error: () => {},
  exit: () => {
    throw new Error("exit");
  },
};

describe("GitHub webhook routing", () => {
  it("rejects ambiguous target selection when multiple targets match", async () => {
    const payload = {
      repository: { full_name: "openclaw/openclaw" },
      action: "created",
      sender: { login: "alice", id: 1 },
      issue: { number: 1 },
      comment: { id: 1, body: "@bot hi" },
    };
    const raw = JSON.stringify(payload);

    const core = {} as PluginRuntime;
    const cfg = {} as OpenClawConfig;
    const unregisterA = registerGitHubWebhookTarget({
      account: account("a"),
      config: cfg,
      runtime: testRuntime,
      core,
      path: "/github",
      webhookSecret: "shared",
    });
    const unregisterB = registerGitHubWebhookTarget({
      account: account("b"),
      config: cfg,
      runtime: testRuntime,
      core,
      path: "/github",
      webhookSecret: "shared",
    });

    try {
      const res = createMockServerResponse();
      const handled = await handleGitHubWebhookRequest(
        createWebhookRequest({
          payload,
          signature: sign("shared", raw),
        }),
        res,
      );
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(401);
      expect(res.body).toContain("ambiguous");
    } finally {
      unregisterA();
      unregisterB();
    }
  });

  it("routes webhook to the only repository-allowed target", async () => {
    const payload = {
      repository: { full_name: "openclaw/openclaw" },
      action: "created",
      sender: { login: "alice", id: 1 },
      issue: { number: 1 },
      comment: { id: 1, body: "@bot hi" },
    };
    const raw = JSON.stringify(payload);

    const sinkA = vi.fn();
    const sinkB = vi.fn();
    const core = {} as PluginRuntime;
    const cfg = {} as OpenClawConfig;
    const unregisterA = registerGitHubWebhookTarget({
      account: account("a", {
        config: {
          webhookPath: "/github",
          repositoryAllowlist: ["other/repo"],
        },
      }),
      config: cfg,
      runtime: testRuntime,
      core,
      path: "/github",
      webhookSecret: "secret-a",
      statusSink: sinkA,
    });
    const unregisterB = registerGitHubWebhookTarget({
      account: account("b", {
        config: {
          webhookPath: "/github",
          repositoryAllowlist: ["openclaw/openclaw"],
        },
      }),
      config: cfg,
      runtime: testRuntime,
      core,
      path: "/github",
      webhookSecret: "secret-b",
      statusSink: sinkB,
    });

    try {
      const res = createMockServerResponse();
      const handled = await handleGitHubWebhookRequest(
        createWebhookRequest({
          payload,
          signature: sign("secret-b", raw),
        }),
        res,
      );
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
      expect(sinkA).not.toHaveBeenCalled();
      expect(sinkB).toHaveBeenCalledTimes(1);
    } finally {
      unregisterA();
      unregisterB();
    }
  });
});
