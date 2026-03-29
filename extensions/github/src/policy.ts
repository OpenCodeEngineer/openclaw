import { normalizeGitHubAllowEntry, normalizeRepoFullName } from "./targets.js";
import type { GitHubAccountConfig, GitHubRepositoryConfig } from "./types.js";

export type ResolvedGitHubRepositoryPolicy = {
  enabled: boolean;
  requireMention: boolean;
  allowFrom: string[];
  systemPrompt?: string;
  tools?: GitHubRepositoryConfig["tools"];
};

function resolveRepositoryConfig(
  repositories: Record<string, GitHubRepositoryConfig | undefined> | undefined,
  repoFullName: string,
): GitHubRepositoryConfig | undefined {
  if (!repositories) {
    return undefined;
  }
  const exact = Object.entries(repositories).find(([key]) => {
    const normalized = normalizeRepoFullName(key);
    return normalized === repoFullName;
  })?.[1];
  const wildcard = repositories["*"];
  if (!wildcard) {
    return exact;
  }
  if (!exact) {
    return wildcard;
  }
  return {
    ...wildcard,
    ...exact,
    allowFrom: exact.allowFrom ?? wildcard.allowFrom,
    skills: exact.skills ?? wildcard.skills,
    tools: exact.tools ?? wildcard.tools,
  };
}

function normalizeAllowList(entries: string[] | undefined): string[] {
  return (entries ?? []).map(normalizeGitHubAllowEntry).filter(Boolean);
}

export function isRepositoryAllowedByConfig(params: {
  config: GitHubAccountConfig;
  repoFullName: string;
}): boolean {
  const normalizedRepo = normalizeRepoFullName(params.repoFullName);
  if (!normalizedRepo) {
    return false;
  }

  const repoAllowlist = (params.config.repositoryAllowlist ?? [])
    .map((entry) => normalizeRepoFullName(entry))
    .filter((entry): entry is string => Boolean(entry));
  if (repoAllowlist.length > 0 && !repoAllowlist.includes(normalizedRepo)) {
    return false;
  }

  const repoConfig = resolveRepositoryConfig(params.config.repositories, normalizedRepo);
  if (repoConfig?.enabled === false) {
    return false;
  }

  return true;
}

export function resolveGitHubRepositoryPolicy(params: {
  config: GitHubAccountConfig;
  repoFullName: string;
}): ResolvedGitHubRepositoryPolicy {
  const repoFullName =
    normalizeRepoFullName(params.repoFullName) ?? params.repoFullName.toLowerCase();
  const repoConfig = resolveRepositoryConfig(params.config.repositories, repoFullName);
  const baseAllowFrom = normalizeAllowList(params.config.allowFrom);
  const repoAllowFrom = normalizeAllowList(repoConfig?.allowFrom);
  const allowFrom = repoAllowFrom.length > 0 ? [...baseAllowFrom, ...repoAllowFrom] : baseAllowFrom;

  return {
    enabled: repoConfig?.enabled !== false,
    requireMention: repoConfig?.requireMention ?? params.config.requireMention ?? true,
    allowFrom,
    systemPrompt: repoConfig?.systemPrompt?.trim() || undefined,
    tools: repoConfig?.tools,
  };
}

export function extractRepoFromGitHubGroupId(groupId?: string | null): string | null {
  if (!groupId) {
    return null;
  }
  const normalized = groupId.trim().toLowerCase();
  const hashIndex = normalized.lastIndexOf("#");
  if (hashIndex <= 0) {
    return null;
  }
  return normalizeRepoFullName(normalized.slice(0, hashIndex));
}
