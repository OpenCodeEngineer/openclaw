import type { ResolvedGitHubAccount } from "./accounts.js";
import { parseGitHubConversationTarget } from "./targets.js";

type GitHubApiErrorBody = {
  message?: string;
  errors?: unknown;
  documentation_url?: string;
};

type GitHubCommentResponse = {
  id?: number;
  html_url?: string;
};

type GitHubUserResponse = {
  login?: string;
};

type GitHubInstallationRepositoriesResponse = {
  total_count?: number;
};

function splitRepo(fullName: string): { owner: string; repo: string } {
  const [owner, repo] = fullName.split("/", 2);
  if (!owner || !repo) {
    throw new Error(`Invalid GitHub repo target: ${fullName}`);
  }
  return { owner, repo };
}

function buildGitHubHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "openclaw-github-channel",
  };
}

async function parseErrorBody(response: Response): Promise<string> {
  let parsed: GitHubApiErrorBody | null = null;
  try {
    parsed = (await response.json()) as GitHubApiErrorBody;
  } catch {
    // ignore parse error and use status text fallback below
  }
  const message = parsed?.message?.trim();
  if (message) {
    return message;
  }
  return response.statusText || "GitHub API request failed";
}

async function githubPostJson<T>(params: {
  account: ResolvedGitHubAccount;
  url: string;
  body: Record<string, unknown>;
}): Promise<T> {
  if (!params.account.token.trim()) {
    throw new Error(
      `GitHub token missing for account "${params.account.accountId}" (set channels.github.token or OPENCLAW_GITHUB_TOKEN).`,
    );
  }
  const response = await fetch(params.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildGitHubHeaders(params.account.token),
    },
    body: JSON.stringify(params.body),
  });
  if (!response.ok) {
    const detail = await parseErrorBody(response);
    throw new Error(`GitHub API ${response.status}: ${detail}`);
  }
  return (await response.json()) as T;
}

export async function sendGitHubIssueComment(params: {
  account: ResolvedGitHubAccount;
  repoFullName: string;
  issueNumber: number;
  body: string;
}): Promise<{ commentId: string; htmlUrl?: string }> {
  const { owner, repo } = splitRepo(params.repoFullName);
  const response = await githubPostJson<GitHubCommentResponse>({
    account: params.account,
    url: `https://api.github.com/repos/${owner}/${repo}/issues/${params.issueNumber}/comments`,
    body: {
      body: params.body,
    },
  });
  const commentId = response.id != null ? String(response.id) : "unknown";
  return { commentId, htmlUrl: response.html_url };
}

export async function sendGitHubReviewCommentReply(params: {
  account: ResolvedGitHubAccount;
  repoFullName: string;
  pullNumber: number;
  commentId: number;
  body: string;
}): Promise<{ commentId: string; htmlUrl?: string }> {
  const { owner, repo } = splitRepo(params.repoFullName);
  const response = await githubPostJson<GitHubCommentResponse>({
    account: params.account,
    url: `https://api.github.com/repos/${owner}/${repo}/pulls/${params.pullNumber}/comments/${params.commentId}/replies`,
    body: {
      body: params.body,
    },
  });
  const commentId = response.id != null ? String(response.id) : "unknown";
  return { commentId, htmlUrl: response.html_url };
}

export async function addGitHubCommentReaction(params: {
  account: ResolvedGitHubAccount;
  repoFullName: string;
  commentId: number;
  reaction: "+1" | "-1" | "laugh" | "hooray" | "confused" | "heart" | "rocket" | "eyes";
}): Promise<void> {
  const { owner, repo } = splitRepo(params.repoFullName);
  await githubPostJson({
    account: params.account,
    url: `https://api.github.com/repos/${owner}/${repo}/issues/comments/${params.commentId}/reactions`,
    body: { content: params.reaction },
  });
}

export async function sendGitHubConversationComment(params: {
  account: ResolvedGitHubAccount;
  to: string;
  text: string;
}): Promise<{ messageId: string; target: string }> {
  const target = parseGitHubConversationTarget(params.to);
  if (!target) {
    throw new Error(
      `Invalid GitHub target: expected owner/repo#<number>, got "${params.to || "<empty>"}"`,
    );
  }
  const result = await sendGitHubIssueComment({
    account: params.account,
    repoFullName: target.repoFullName,
    issueNumber: target.issueNumber,
    body: params.text,
  });
  return {
    messageId: result.commentId,
    target: `${target.repoFullName}#${target.issueNumber}`,
  };
}

export async function probeGitHub(params: {
  account: ResolvedGitHubAccount;
  timeoutMs: number;
}): Promise<{ ok: boolean; login?: string; message?: string }> {
  const token = params.account.token.trim();
  if (!token) {
    return {
      ok: false,
      message: "missing token",
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, params.timeoutMs));
  try {
    const userResponse = await fetch("https://api.github.com/user", {
      method: "GET",
      headers: buildGitHubHeaders(token),
      signal: controller.signal,
    });
    if (!userResponse.ok) {
      const detail = await parseErrorBody(userResponse);
      // GitHub App installation tokens cannot call /user, but they can call
      // installation-scoped endpoints. Treat that as a healthy token.
      if (userResponse.status === 403 && /resource not accessible by integration/i.test(detail)) {
        const installResponse = await fetch(
          "https://api.github.com/installation/repositories?per_page=1",
          {
            method: "GET",
            headers: buildGitHubHeaders(token),
            signal: controller.signal,
          },
        );
        if (installResponse.ok) {
          const data = (await installResponse.json()) as GitHubInstallationRepositoriesResponse;
          const total = typeof data.total_count === "number" ? data.total_count : undefined;
          return {
            ok: true,
            message:
              total != null
                ? `GitHub App installation token (repositories: ${total})`
                : "GitHub App installation token",
          };
        }
      }
      return {
        ok: false,
        message: `HTTP ${userResponse.status}: ${detail}`,
      };
    }
    const data = (await userResponse.json()) as GitHubUserResponse;
    return {
      ok: true,
      login: data.login,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}
