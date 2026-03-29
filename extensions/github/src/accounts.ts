import { readFileSync } from "node:fs";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import type { CoreConfig, GitHubAccountConfig } from "./types.js";

function isTruthyEnvValue(value?: string): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

const debugAccounts = (...args: unknown[]) => {
  if (isTruthyEnvValue(process.env.OPENCLAW_DEBUG_GITHUB_ACCOUNTS)) {
    console.warn("[github:accounts]", ...args);
  }
};

export type ResolvedGitHubAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  token: string;
  tokenSource: "env" | "tokenFile" | "config" | "none";
  webhookSecret: string;
  webhookSecretSource: "env" | "secretFile" | "config" | "none";
  config: GitHubAccountConfig;
};

function listConfiguredAccountIds(cfg: CoreConfig): string[] {
  const accounts = cfg.channels?.github?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return [];
  }
  const ids = new Set<string>();
  for (const key of Object.keys(accounts)) {
    if (!key) {
      continue;
    }
    ids.add(normalizeAccountId(key));
  }
  return [...ids];
}

export function listGitHubAccountIds(cfg: CoreConfig): string[] {
  const ids = listConfiguredAccountIds(cfg);
  if (ids.length === 0) {
    return [DEFAULT_ACCOUNT_ID];
  }
  return ids.toSorted((a, b) => a.localeCompare(b));
}

export function resolveDefaultGitHubAccountId(cfg: CoreConfig): string {
  const ids = listGitHubAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) {
    return DEFAULT_ACCOUNT_ID;
  }
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

function resolveAccountConfig(cfg: CoreConfig, accountId: string): GitHubAccountConfig | undefined {
  const accounts = cfg.channels?.github?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return undefined;
  }
  const direct = accounts[accountId] as GitHubAccountConfig | undefined;
  if (direct) {
    return direct;
  }
  const normalized = normalizeAccountId(accountId);
  const matchKey = Object.keys(accounts).find((key) => normalizeAccountId(key) === normalized);
  return matchKey ? (accounts[matchKey] as GitHubAccountConfig | undefined) : undefined;
}

function mergeGitHubAccountConfig(cfg: CoreConfig, accountId: string): GitHubAccountConfig {
  const { accounts: _ignored, ...base } = (cfg.channels?.github ?? {}) as GitHubAccountConfig & {
    accounts?: unknown;
  };
  const account = resolveAccountConfig(cfg, accountId) ?? {};
  return { ...base, ...account };
}

function resolveToken(
  cfg: CoreConfig,
  opts: { accountId?: string },
): { token: string; source: ResolvedGitHubAccount["tokenSource"] } {
  const merged = mergeGitHubAccountConfig(cfg, opts.accountId ?? DEFAULT_ACCOUNT_ID);
  const isDefault = !opts.accountId || opts.accountId === DEFAULT_ACCOUNT_ID;

  if (isDefault) {
    const envToken = process.env.OPENCLAW_GITHUB_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim();
    if (envToken) {
      return { token: envToken, source: "env" };
    }
  }

  if (merged.tokenFile) {
    try {
      const fileToken = readFileSync(merged.tokenFile, "utf-8").trim();
      if (fileToken) {
        return { token: fileToken, source: "tokenFile" };
      }
    } catch {
      // Ignore unreadable token file and continue with other sources.
    }
  }

  if (merged.token?.trim()) {
    return { token: merged.token.trim(), source: "config" };
  }

  return { token: "", source: "none" };
}

function resolveWebhookSecret(
  cfg: CoreConfig,
  opts: { accountId?: string },
): { secret: string; source: ResolvedGitHubAccount["webhookSecretSource"] } {
  const merged = mergeGitHubAccountConfig(cfg, opts.accountId ?? DEFAULT_ACCOUNT_ID);
  const isDefault = !opts.accountId || opts.accountId === DEFAULT_ACCOUNT_ID;

  if (isDefault) {
    const envSecret = process.env.OPENCLAW_GITHUB_WEBHOOK_SECRET?.trim();
    if (envSecret) {
      return { secret: envSecret, source: "env" };
    }
  }

  if (merged.webhookSecretFile) {
    try {
      const fileSecret = readFileSync(merged.webhookSecretFile, "utf-8").trim();
      if (fileSecret) {
        return { secret: fileSecret, source: "secretFile" };
      }
    } catch {
      // Ignore unreadable secret file and continue with other sources.
    }
  }

  if (merged.webhookSecret?.trim()) {
    return { secret: merged.webhookSecret.trim(), source: "config" };
  }

  return { secret: "", source: "none" };
}

export function resolveGitHubAccount(params: {
  cfg: CoreConfig;
  accountId?: string | null;
}): ResolvedGitHubAccount {
  const hasExplicitAccountId = Boolean(params.accountId?.trim());
  const baseEnabled = params.cfg.channels?.github?.enabled !== false;

  const resolve = (accountId: string) => {
    const merged = mergeGitHubAccountConfig(params.cfg, accountId);
    const accountEnabled = merged.enabled !== false;
    const enabled = baseEnabled && accountEnabled;
    const tokenResolution = resolveToken(params.cfg, { accountId });
    const webhookSecretResolution = resolveWebhookSecret(params.cfg, { accountId });

    debugAccounts("resolve", {
      accountId,
      enabled,
      tokenSource: tokenResolution.source,
      webhookSecretSource: webhookSecretResolution.source,
    });

    return {
      accountId,
      enabled,
      name: merged.name?.trim() || undefined,
      token: tokenResolution.token,
      tokenSource: tokenResolution.source,
      webhookSecret: webhookSecretResolution.secret,
      webhookSecretSource: webhookSecretResolution.source,
      config: merged,
    } satisfies ResolvedGitHubAccount;
  };

  const normalized = normalizeAccountId(params.accountId);
  const primary = resolve(normalized);
  if (hasExplicitAccountId) {
    return primary;
  }
  if (primary.tokenSource !== "none") {
    return primary;
  }

  const fallbackId = resolveDefaultGitHubAccountId(params.cfg);
  if (fallbackId === primary.accountId) {
    return primary;
  }
  const fallback = resolve(fallbackId);
  if (fallback.tokenSource === "none") {
    return primary;
  }
  return fallback;
}

export function listEnabledGitHubAccounts(cfg: CoreConfig): ResolvedGitHubAccount[] {
  return listGitHubAccountIds(cfg)
    .map((accountId) => resolveGitHubAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}
