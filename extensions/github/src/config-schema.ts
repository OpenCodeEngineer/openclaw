import {
  BlockStreamingCoalesceSchema,
  MarkdownConfigSchema,
  ToolPolicySchema,
} from "openclaw/plugin-sdk";
import { z } from "zod";

export const GitHubEventsSchema = z
  .object({
    issueComment: z.boolean().optional(),
    pullRequestReviewComment: z.boolean().optional(),
    pullRequestReview: z.boolean().optional(),
  })
  .strict();

export const GitHubRepositorySchema = z
  .object({
    enabled: z.boolean().optional(),
    requireMention: z.boolean().optional(),
    allowFrom: z.array(z.string()).optional(),
    systemPrompt: z.string().optional(),
    tools: ToolPolicySchema,
    skills: z.array(z.string()).optional(),
  })
  .strict();

export const GitHubAccountSchemaBase = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    token: z.string().optional(),
    tokenFile: z.string().optional(),
    webhookSecret: z.string().optional(),
    webhookSecretFile: z.string().optional(),
    webhookPath: z.string().optional(),
    webhookUrl: z.string().optional(),
    botLogin: z.string().optional(),
    requireMention: z.boolean().optional(),
    allowFrom: z.array(z.string()).optional(),
    repositoryAllowlist: z.array(z.string()).optional(),
    repositories: z.record(z.string(), GitHubRepositorySchema.optional()).optional(),
    events: GitHubEventsSchema.optional(),
    markdown: MarkdownConfigSchema,
    textChunkLimit: z.number().int().positive().optional(),
    chunkMode: z.enum(["length", "newline"]).optional(),
    blockStreaming: z.boolean().optional(),
    blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
    responsePrefix: z.string().optional(),
  })
  .strict();

export const GitHubAccountSchema = GitHubAccountSchemaBase;

export const GitHubConfigSchema = GitHubAccountSchemaBase.extend({
  accounts: z.record(z.string(), GitHubAccountSchema.optional()).optional(),
});
