import crypto from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import { callGateway } from "../../gateway/call.js";
import { normalizeAgentId, resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import { SESSION_LABEL_MAX_LENGTH } from "../../sessions/session-label.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";
import {
  createAgentToAgentPolicy,
  createSessionVisibilityGuard,
  resolveDisplaySessionKey,
  resolveEffectiveSessionToolsVisibility,
  resolveSessionReference,
  resolveSessionToolContext,
  resolveVisibleSessionReference,
} from "./sessions-helpers.js";

const SessionsRenameToolSchema = Type.Object({
  sessionKey: Type.Optional(Type.String()),
  targetLabel: Type.Optional(Type.String({ minLength: 1, maxLength: SESSION_LABEL_MAX_LENGTH })),
  agentId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  newLabel: Type.String({ minLength: 1, maxLength: SESSION_LABEL_MAX_LENGTH }),
});

type GatewayCaller = typeof callGateway;

function forbiddenRenameResult(error: string, sessionKey?: string) {
  return jsonResult({
    runId: crypto.randomUUID(),
    status: "forbidden",
    error,
    ...(sessionKey ? { sessionKey } : {}),
  });
}

function errorRenameResult(error: string, sessionKey?: string) {
  return jsonResult({
    runId: crypto.randomUUID(),
    status: "error",
    error,
    ...(sessionKey ? { sessionKey } : {}),
  });
}

export function createSessionsRenameTool(opts?: {
  agentSessionKey?: string;
  sandboxed?: boolean;
  config?: OpenClawConfig;
  callGateway?: GatewayCaller;
}): AnyAgentTool {
  return {
    label: "Session Rename",
    name: "sessions_rename",
    description:
      "Rename the current session or another visible session. Use sessionKey or targetLabel to identify a specific target.",
    parameters: SessionsRenameToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const gatewayCall = opts?.callGateway ?? callGateway;
      const newLabel = readStringParam(params, "newLabel", {
        required: true,
        label: "newLabel",
      });
      const sessionKeyParam = readStringParam(params, "sessionKey");
      const targetLabelParam = readStringParam(params, "targetLabel");
      const labelAgentIdParam = readStringParam(params, "agentId");

      if (sessionKeyParam && targetLabelParam) {
        return errorRenameResult("Provide either sessionKey or targetLabel (not both).");
      }

      const { cfg, mainKey, alias, effectiveRequesterKey, restrictToSpawned } =
        resolveSessionToolContext(opts);
      const a2aPolicy = createAgentToAgentPolicy(cfg);
      const sessionVisibility = resolveEffectiveSessionToolsVisibility({
        cfg,
        sandboxed: opts?.sandboxed === true,
      });
      const visibilityGuard = await createSessionVisibilityGuard({
        action: "rename",
        requesterSessionKey: effectiveRequesterKey,
        visibility: sessionVisibility,
        a2aPolicy,
      });

      let resolvedKey = "";
      let displayKey = "";

      if (targetLabelParam?.trim()) {
        const label = targetLabelParam.trim();
        const requesterAgentId = resolveAgentIdFromSessionKey(effectiveRequesterKey);
        const requestedAgentId = labelAgentIdParam?.trim()
          ? normalizeAgentId(labelAgentIdParam)
          : undefined;

        if (requestedAgentId && requestedAgentId !== requesterAgentId) {
          if (sessionVisibility !== "all") {
            return forbiddenRenameResult(
              "Session rename visibility is restricted. Set tools.sessions.visibility=all to allow cross-agent access.",
            );
          }
          if (!a2aPolicy.enabled) {
            return forbiddenRenameResult(
              "Agent-to-agent rename is disabled. Set tools.agentToAgent.enabled=true to allow cross-agent access.",
            );
          }
          if (!a2aPolicy.isAllowed(requesterAgentId, requestedAgentId)) {
            return forbiddenRenameResult(
              "Agent-to-agent rename denied by tools.agentToAgent.allow.",
            );
          }
        }

        try {
          const resolved = await gatewayCall<{ key?: string }>({
            method: "sessions.resolve",
            params: {
              label,
              ...(requestedAgentId ? { agentId: requestedAgentId } : {}),
              ...(restrictToSpawned ? { spawnedBy: effectiveRequesterKey } : {}),
            },
            timeoutMs: 10_000,
          });
          resolvedKey = typeof resolved?.key === "string" ? resolved.key.trim() : "";
        } catch (err) {
          if (restrictToSpawned) {
            return forbiddenRenameResult("Session not visible from this sandboxed agent session.");
          }
          const message = err instanceof Error ? err.message : String(err);
          return errorRenameResult(message || `No session found with label: ${label}`);
        }

        if (!resolvedKey) {
          if (restrictToSpawned) {
            return forbiddenRenameResult("Session not visible from this sandboxed agent session.");
          }
          return errorRenameResult(`No session found with label: ${label}`);
        }

        const access = visibilityGuard.check(resolvedKey);
        displayKey = resolveDisplaySessionKey({
          key: resolvedKey,
          alias,
          mainKey,
        });
        if (!access.allowed) {
          return jsonResult({
            runId: crypto.randomUUID(),
            status: access.status,
            error: access.error,
            sessionKey: displayKey,
          });
        }
      } else {
        const requestedKey = sessionKeyParam ?? effectiveRequesterKey;
        const resolvedSession = await resolveSessionReference({
          sessionKey: requestedKey,
          alias,
          mainKey,
          requesterInternalKey: effectiveRequesterKey,
          restrictToSpawned,
        });
        if (!resolvedSession.ok) {
          return jsonResult({
            runId: crypto.randomUUID(),
            status: resolvedSession.status,
            error: resolvedSession.error,
          });
        }
        const visibleSession = await resolveVisibleSessionReference({
          resolvedSession,
          requesterSessionKey: effectiveRequesterKey,
          restrictToSpawned,
          visibilitySessionKey: requestedKey,
        });
        if (!visibleSession.ok) {
          return jsonResult({
            runId: crypto.randomUUID(),
            status: visibleSession.status,
            error: visibleSession.error,
            sessionKey: visibleSession.displayKey,
          });
        }
        const access = visibilityGuard.check(visibleSession.key);
        if (!access.allowed) {
          return jsonResult({
            runId: crypto.randomUUID(),
            status: access.status,
            error: access.error,
            sessionKey: visibleSession.displayKey,
          });
        }
        resolvedKey = visibleSession.key;
        displayKey = visibleSession.displayKey;
      }

      try {
        await gatewayCall({
          method: "sessions.patch",
          params: {
            key: resolvedKey,
            label: newLabel,
          },
          timeoutMs: 10_000,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return errorRenameResult(message || "Failed to rename session.", displayKey);
      }

      return jsonResult({
        runId: crypto.randomUUID(),
        status: "ok",
        sessionKey: displayKey,
        label: newLabel,
      });
    },
  };
}
