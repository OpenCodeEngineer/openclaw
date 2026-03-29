import type {
  BlockStreamingCoalesceConfig,
  GroupToolPolicyConfig,
  MarkdownConfig,
  OpenClawConfig,
} from "openclaw/plugin-sdk";

export type GitHubEventsConfig = {
  issueComment?: boolean;
  pullRequestReviewComment?: boolean;
  pullRequestReview?: boolean;
};

export type GitHubRepositoryConfig = {
  enabled?: boolean;
  requireMention?: boolean;
  allowFrom?: string[];
  systemPrompt?: string;
  tools?: GroupToolPolicyConfig;
  skills?: string[];
};

export type GitHubAccountConfig = {
  name?: string;
  enabled?: boolean;
  token?: string;
  tokenFile?: string;
  webhookSecret?: string;
  webhookSecretFile?: string;
  webhookPath?: string;
  webhookUrl?: string;
  botLogin?: string;
  requireMention?: boolean;
  allowFrom?: string[];
  repositoryAllowlist?: string[];
  repositories?: Record<string, GitHubRepositoryConfig | undefined>;
  events?: GitHubEventsConfig;
  textChunkLimit?: number;
  chunkMode?: "length" | "newline";
  markdown?: MarkdownConfig;
  blockStreaming?: boolean;
  blockStreamingCoalesce?: BlockStreamingCoalesceConfig;
  responsePrefix?: string;
};

export type GitHubConfig = GitHubAccountConfig & {
  accounts?: Record<string, GitHubAccountConfig | undefined>;
};

export type CoreConfig = OpenClawConfig & {
  channels?: OpenClawConfig["channels"] & {
    github?: GitHubConfig;
  };
};

export type GitHubWebhookEventName =
  | "issue_comment"
  | "pull_request_review_comment"
  | "pull_request_review";

export type GitHubEventSourceKind = "issue_comment" | "review_comment" | "review";

export type GitHubInboundEvent = {
  eventName: GitHubWebhookEventName;
  sourceKind: GitHubEventSourceKind;
  repoFullName: string;
  issueNumber: number;
  pullRequestNumber?: number;
  actorLogin: string;
  actorId: string;
  body: string;
  commentId?: number;
  reviewId?: number;
  messageId: string;
  htmlUrl?: string;
  threadTarget: string;
};
