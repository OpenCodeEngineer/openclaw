import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";

const callGatewayMock = vi.fn();
vi.mock("../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => ({
      session: {
        mainKey: "main",
        scope: "per-sender",
        agentToAgent: { maxPingPongTurns: 2 },
      },
      tools: {
        sessions: { visibility: "all" },
        agentToAgent: { enabled: true },
      },
    }),
    resolveGatewayPort: () => 18789,
  };
});

import "./test-helpers/fast-core-tools.js";
import { __testing as openClawToolsTesting, createOpenClawTools } from "./openclaw-tools.js";
import { __testing as sessionsResolutionTesting } from "./tools/sessions-resolution.js";

const TEST_CONFIG = {
  session: {
    mainKey: "main",
    scope: "per-sender",
    agentToAgent: { maxPingPongTurns: 2 },
  },
  tools: {
    sessions: { visibility: "all" },
    agentToAgent: { enabled: true },
  },
} as OpenClawConfig;

describe("sessions_rename tool", () => {
  beforeEach(() => {
    callGatewayMock.mockReset();
    openClawToolsTesting.setDepsForTest({
      callGateway: (opts: unknown) => callGatewayMock(opts),
      config: TEST_CONFIG,
    });
    sessionsResolutionTesting.setDepsForTest({
      callGateway: (opts: unknown) => callGatewayMock(opts),
    });
  });

  it("uses a string schema for newLabel", () => {
    const tool = createOpenClawTools().find((candidate) => candidate.name === "sessions_rename");
    expect(tool).toBeDefined();
    if (!tool) {
      throw new Error("missing sessions_rename tool");
    }

    const schema = tool.parameters as {
      properties?: Record<string, { type?: unknown }>;
      anyOf?: unknown;
      oneOf?: unknown;
    };
    expect(schema.anyOf).toBeUndefined();
    expect(schema.oneOf).toBeUndefined();
    expect(schema.properties?.newLabel?.type).toBe("string");
  });

  it("renames the current session when no target is provided", async () => {
    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string; params?: Record<string, unknown> };
      if (request.method === "sessions.patch") {
        return {
          ok: true,
          key: request.params?.key,
        };
      }
      throw new Error(`unexpected method: ${request.method}`);
    });

    const tool = createOpenClawTools({
      agentSessionKey: "agent:main:main",
    }).find((candidate) => candidate.name === "sessions_rename");
    expect(tool).toBeDefined();
    if (!tool) {
      throw new Error("missing sessions_rename tool");
    }

    const result = await tool.execute("call-rename-current", {
      newLabel: "Fix session labels",
    });
    expect(result.details).toMatchObject({
      status: "ok",
      sessionKey: "agent:main:main",
      label: "Fix session labels",
    });
    expect(callGatewayMock).toHaveBeenCalledWith({
      method: "sessions.patch",
      params: {
        key: "agent:main:main",
        label: "Fix session labels",
      },
      timeoutMs: 10_000,
    });
  });

  it("resolves targetLabel before renaming another session", async () => {
    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string; params?: Record<string, unknown> };
      if (request.method === "sessions.resolve") {
        return {
          key: "agent:ops-agent:ui:20260328-102501-chat-1a2b",
        };
      }
      if (request.method === "sessions.patch") {
        return {
          ok: true,
          key: request.params?.key,
        };
      }
      throw new Error(`unexpected method: ${request.method}`);
    });

    const tool = createOpenClawTools({
      agentSessionKey: "agent:main:main",
    }).find((candidate) => candidate.name === "sessions_rename");
    expect(tool).toBeDefined();
    if (!tool) {
      throw new Error("missing sessions_rename tool");
    }

    const result = await tool.execute("call-rename-target", {
      targetLabel: "Chat 2026-03-28 10:25:01",
      agentId: "ops-agent",
      newLabel: "Ops follow-up",
    });
    expect(result.details).toMatchObject({
      status: "ok",
      sessionKey: "agent:ops-agent:ui:20260328-102501-chat-1a2b",
      label: "Ops follow-up",
    });
    expect(callGatewayMock).toHaveBeenNthCalledWith(1, {
      method: "sessions.resolve",
      params: {
        label: "Chat 2026-03-28 10:25:01",
        agentId: "ops-agent",
      },
      timeoutMs: 10_000,
    });
    expect(callGatewayMock).toHaveBeenNthCalledWith(2, {
      method: "sessions.patch",
      params: {
        key: "agent:ops-agent:ui:20260328-102501-chat-1a2b",
        label: "Ops follow-up",
      },
      timeoutMs: 10_000,
    });
  });

  it("rejects ambiguous targets", async () => {
    const tool = createOpenClawTools({
      agentSessionKey: "agent:main:main",
    }).find((candidate) => candidate.name === "sessions_rename");
    expect(tool).toBeDefined();
    if (!tool) {
      throw new Error("missing sessions_rename tool");
    }

    const result = await tool.execute("call-rename-ambiguous", {
      sessionKey: "main",
      targetLabel: "Chat 2026-03-28 10:25:01",
      newLabel: "Ops follow-up",
    });
    expect(result.details).toMatchObject({
      status: "error",
      error: "Provide either sessionKey or targetLabel (not both).",
    });
    expect(callGatewayMock).not.toHaveBeenCalled();
  });

  it("blocks cross-agent label lookup when agent-to-agent access is disabled", async () => {
    const tool = createOpenClawTools({
      agentSessionKey: "agent:main:main",
      config: {
        ...TEST_CONFIG,
        tools: {
          ...TEST_CONFIG.tools,
          agentToAgent: { enabled: false },
        },
      },
    }).find((candidate) => candidate.name === "sessions_rename");
    expect(tool).toBeDefined();
    if (!tool) {
      throw new Error("missing sessions_rename tool");
    }

    const result = await tool.execute("call-rename-forbidden", {
      targetLabel: "Planning",
      agentId: "ops-agent",
      newLabel: "Ops follow-up",
    });
    expect(result.details).toMatchObject({
      status: "forbidden",
      error:
        "Agent-to-agent rename is disabled. Set tools.agentToAgent.enabled=true to allow cross-agent access.",
    });
    expect(callGatewayMock).not.toHaveBeenCalled();
  });
});
