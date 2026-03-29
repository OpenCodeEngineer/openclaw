export type GitHubConversationTarget = {
  repoFullName: string;
  issueNumber: number;
};

const GITHUB_REPO_PATTERN = /^([a-z0-9_.-]+\/[a-z0-9_.-]+)$/i;
const CONVERSATION_PATTERN = /^([a-z0-9_.-]+\/[a-z0-9_.-]+)#(?:issue:|pr:|pull:)?(\d+)$/i;

export function normalizeRepoFullName(raw?: string | null): string | null {
  const trimmed = raw?.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  if (!GITHUB_REPO_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function formatGitHubConversationTarget(target: GitHubConversationTarget): string {
  return `${target.repoFullName}#${target.issueNumber}`;
}

export function parseGitHubConversationTarget(
  raw?: string | null,
): GitHubConversationTarget | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }
  const withoutPrefix = trimmed.replace(/^github:/i, "");
  const match = CONVERSATION_PATTERN.exec(withoutPrefix);
  if (!match) {
    return null;
  }
  const repoFullName = normalizeRepoFullName(match[1]);
  if (!repoFullName) {
    return null;
  }
  const issueNumber = Number.parseInt(match[2], 10);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    return null;
  }
  return {
    repoFullName,
    issueNumber,
  };
}

export function normalizeGitHubMessagingTarget(raw?: string | null): string | null {
  const parsed = parseGitHubConversationTarget(raw);
  if (!parsed) {
    return null;
  }
  return formatGitHubConversationTarget(parsed);
}

export function looksLikeGitHubTargetId(raw?: string | null): boolean {
  if (!raw?.trim()) {
    return false;
  }
  return parseGitHubConversationTarget(raw) !== null;
}

export function normalizeGitHubAllowEntry(raw: string): string {
  return raw
    .trim()
    .replace(/^github:/i, "")
    .replace(/^user:/i, "")
    .replace(/^@/, "")
    .toLowerCase();
}

export function isGitHubActorAllowed(params: {
  allowFrom: string[];
  actorLogin: string;
  actorId: string;
}): { allowed: boolean; matchKey?: string } {
  const allowFrom = params.allowFrom.map(normalizeGitHubAllowEntry).filter(Boolean);
  if (allowFrom.length === 0) {
    return { allowed: true };
  }
  if (allowFrom.includes("*")) {
    return { allowed: true, matchKey: "*" };
  }
  const login = normalizeGitHubAllowEntry(params.actorLogin);
  if (login && allowFrom.includes(login)) {
    return { allowed: true, matchKey: login };
  }
  const actorId = String(params.actorId).trim().toLowerCase();
  if (actorId && allowFrom.includes(actorId)) {
    return { allowed: true, matchKey: actorId };
  }
  return { allowed: false };
}
