import {
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  formatPairingApproveHint,
  normalizeAccountId,
  setAccountEnabledInConfigSection,
  waitUntilAbort,
  type ChannelPlugin,
  type OpenClawConfig,
} from "openclaw/plugin-sdk";
import {
  listGitHubAccountIds,
  resolveDefaultGitHubAccountId,
  resolveGitHubAccount,
  type ResolvedGitHubAccount,
} from "./accounts.js";
import { resolveGitHubWebhookPath, startGitHubMonitor } from "./monitor.js";
import { extractRepoFromGitHubGroupId, resolveGitHubRepositoryPolicy } from "./policy.js";
import { getGitHubRuntime } from "./runtime.js";
import { probeGitHub, sendGitHubConversationComment } from "./send.js";
import {
  looksLikeGitHubTargetId,
  normalizeGitHubAllowEntry,
  normalizeGitHubMessagingTarget,
} from "./targets.js";
import type { CoreConfig } from "./types.js";

const meta = {
  id: "github",
  label: "GitHub",
  selectionLabel: "GitHub (Issues + PR comments)",
  detailLabel: "GitHub",
  docsPath: "/channels/github",
  docsLabel: "github",
  blurb: "Issue and pull request comment workflows via GitHub webhooks.",
  aliases: ["gh"],
  order: 68,
  quickstartAllowFrom: true,
};

export const githubPlugin: ChannelPlugin<ResolvedGitHubAccount> = {
  id: "github",
  meta,
  capabilities: {
    chatTypes: ["group", "thread"],
    threads: true,
    media: true,
    nativeCommands: false,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.github"] },
  config: {
    listAccountIds: (cfg) => listGitHubAccountIds(cfg as CoreConfig),
    resolveAccount: (cfg, accountId) => resolveGitHubAccount({ cfg: cfg as CoreConfig, accountId }),
    defaultAccountId: (cfg) => resolveDefaultGitHubAccountId(cfg as CoreConfig),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg: cfg as CoreConfig,
        sectionKey: "github",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg: cfg as CoreConfig,
        sectionKey: "github",
        accountId,
        clearBaseFields: [
          "name",
          "token",
          "tokenFile",
          "webhookSecret",
          "webhookSecretFile",
          "webhookPath",
          "webhookUrl",
          "botLogin",
        ],
      }),
    isConfigured: (account) => account.tokenSource !== "none",
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.tokenSource !== "none",
      tokenSource: account.tokenSource,
      webhookSecretSource: account.webhookSecretSource,
      webhookPath: account.config.webhookPath,
      webhookUrl: account.config.webhookUrl,
      botLogin: account.config.botLogin,
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveGitHubAccount({ cfg: cfg as CoreConfig, accountId }).config.allowFrom ?? []).map(
        (entry) => String(entry),
      ),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom.map((entry) => normalizeGitHubAllowEntry(String(entry))).filter(Boolean),
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const useAccountPath = Boolean(cfg.channels?.github?.accounts?.[resolvedAccountId]);
      const allowFromPath = useAccountPath
        ? `channels.github.accounts.${resolvedAccountId}.allowFrom`
        : "channels.github.allowFrom";
      return {
        policy: "allowlist",
        allowFrom: account.config.allowFrom ?? [],
        allowFromPath,
        approveHint: formatPairingApproveHint("github"),
        normalizeEntry: (raw) => normalizeGitHubAllowEntry(raw),
      };
    },
    collectWarnings: ({ account }) => {
      const warnings: string[] = [];
      if (!account.webhookSecret.trim()) {
        warnings.push(
          "- GitHub webhook secret is empty. Set channels.github.webhookSecret (or OPENCLAW_GITHUB_WEBHOOK_SECRET) and configure the same secret in your GitHub webhook settings.",
        );
      }
      if (!account.config.botLogin?.trim()) {
        warnings.push(
          "- GitHub botLogin is not set. Mention gating cannot detect @mentions reliably; set channels.github.botLogin.",
        );
      }
      return warnings;
    },
  },
  groups: {
    resolveRequireMention: ({ cfg, accountId, groupId }) => {
      const repoFullName = extractRepoFromGitHubGroupId(groupId);
      const account = resolveGitHubAccount({
        cfg: cfg as CoreConfig,
        accountId: accountId ?? undefined,
      });
      if (!repoFullName) {
        return account.config.requireMention ?? true;
      }
      return resolveGitHubRepositoryPolicy({
        config: account.config,
        repoFullName,
      }).requireMention;
    },
    resolveToolPolicy: ({ cfg, accountId, groupId }) => {
      const repoFullName = extractRepoFromGitHubGroupId(groupId);
      if (!repoFullName) {
        return undefined;
      }
      const account = resolveGitHubAccount({
        cfg: cfg as CoreConfig,
        accountId: accountId ?? undefined,
      });
      return resolveGitHubRepositoryPolicy({
        config: account.config,
        repoFullName,
      }).tools;
    },
  },
  messaging: {
    normalizeTarget: (raw) => normalizeGitHubMessagingTarget(raw) ?? undefined,
    targetResolver: {
      looksLikeId: looksLikeGitHubTargetId,
      hint: "<owner/repo#number>",
    },
  },
  resolver: {
    resolveTargets: async ({ inputs }) =>
      inputs.map((input) => {
        const normalized = normalizeGitHubMessagingTarget(input);
        if (!normalized) {
          return {
            input,
            resolved: false,
            note: "expected owner/repo#<number>",
          };
        }
        return {
          input,
          resolved: true,
          id: normalized,
          name: normalized,
        };
      }),
  },
  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) => getGitHubRuntime().channel.text.chunkMarkdownText(text, limit),
    chunkerMode: "markdown",
    textChunkLimit: 60000,
    sendText: async ({ to, text, accountId }) => {
      const account = resolveGitHubAccount({
        cfg: getGitHubRuntime().config.loadConfig() as CoreConfig,
        accountId: accountId ?? undefined,
      });
      const result = await sendGitHubConversationComment({
        account,
        to,
        text,
      });
      return { channel: "github", ...result };
    },
    sendMedia: async ({ to, text, mediaUrl, accountId }) => {
      const account = resolveGitHubAccount({
        cfg: getGitHubRuntime().config.loadConfig() as CoreConfig,
        accountId: accountId ?? undefined,
      });
      const combined = mediaUrl ? `${text}\n\nAttachment: ${mediaUrl}` : text;
      const result = await sendGitHubConversationComment({
        account,
        to,
        text: combined,
      });
      return { channel: "github", ...result };
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      tokenSource: snapshot.tokenSource ?? "none",
      secretSource: snapshot.secretSource ?? "none",
      webhookPath: snapshot.webhookPath ?? null,
      webhookUrl: snapshot.webhookUrl ?? null,
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ account, timeoutMs }) => probeGitHub({ account, timeoutMs }),
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.tokenSource !== "none",
      tokenSource: account.tokenSource,
      secretSource: account.webhookSecretSource,
      webhookPath: account.config.webhookPath,
      webhookUrl: account.config.webhookUrl,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      lastInboundAt: runtime?.lastInboundAt ?? null,
      lastOutboundAt: runtime?.lastOutboundAt ?? null,
      probe,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      if (!account.token.trim()) {
        throw new Error(
          `GitHub token is not configured for account "${account.accountId}" (set channels.github.token or OPENCLAW_GITHUB_TOKEN).`,
        );
      }

      ctx.log?.info(`[${account.accountId}] starting GitHub webhook monitor`);
      ctx.setStatus({
        accountId: account.accountId,
        running: true,
        lastStartAt: Date.now(),
        webhookPath: resolveGitHubWebhookPath({ account }),
      });

      const unregister = await startGitHubMonitor({
        account,
        config: ctx.cfg as OpenClawConfig,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        webhookPath: account.config.webhookPath,
        webhookUrl: account.config.webhookUrl,
        statusSink: (patch) => ctx.setStatus({ accountId: account.accountId, ...patch }),
      });

      // Keep the channel task alive until gateway stop/abort; resolving here
      // would be treated as a crash and trigger endless auto-restart.
      return waitUntilAbort(ctx.abortSignal, () => {
        unregister?.();
        ctx.setStatus({
          accountId: account.accountId,
          running: false,
          lastStopAt: Date.now(),
        });
      });
    },
  },
};
