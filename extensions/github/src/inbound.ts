import {
  createReplyPrefixOptions,
  logInboundDrop,
  resolveControlCommandGate,
  resolveMentionGatingWithBypass,
  type OpenClawConfig,
  type PluginRuntime,
  type RuntimeEnv,
} from "openclaw/plugin-sdk";
import type { ResolvedGitHubAccount } from "./accounts.js";
import { resolveGitHubRepositoryPolicy } from "./policy.js";
import {
  addGitHubCommentReaction,
  sendGitHubIssueComment,
  sendGitHubReviewCommentReply,
} from "./send.js";
import { isGitHubActorAllowed } from "./targets.js";
import type { GitHubInboundEvent } from "./types.js";

const CHANNEL_ID = "github" as const;

export type GitHubInboundTarget = {
  account: ResolvedGitHubAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  core: PluginRuntime;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

function getStringRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function getString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getPositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

export function parseGitHubInboundEvent(
  eventName: string,
  payload: unknown,
): GitHubInboundEvent | null {
  const root = getStringRecord(payload);
  if (!root) {
    return null;
  }

  const repository = getStringRecord(root.repository);
  const repoFullName = getString(repository?.full_name)?.toLowerCase();
  if (!repoFullName) {
    return null;
  }

  const sender = getStringRecord(root.sender);
  const senderLogin = getString(sender?.login);
  const senderId = getPositiveInt(sender?.id);
  if (!senderLogin || !senderId) {
    return null;
  }

  if (eventName === "issue_comment") {
    if (getString(root.action) !== "created") {
      return null;
    }
    const issue = getStringRecord(root.issue);
    const comment = getStringRecord(root.comment);
    const issueNumber = getPositiveInt(issue?.number);
    const commentId = getPositiveInt(comment?.id);
    const body = getString(comment?.body);
    if (!issueNumber || !commentId || !body) {
      return null;
    }
    const isPullRequest = Boolean(getStringRecord(issue?.pull_request));
    return {
      eventName: "issue_comment",
      sourceKind: "issue_comment",
      repoFullName,
      issueNumber,
      pullRequestNumber: isPullRequest ? issueNumber : undefined,
      actorLogin: senderLogin,
      actorId: String(senderId),
      body,
      commentId,
      messageId: `issue-comment:${commentId}`,
      htmlUrl: getString(comment?.html_url) ?? undefined,
      threadTarget: `${repoFullName}#${issueNumber}`,
    };
  }

  if (eventName === "pull_request_review_comment") {
    if (getString(root.action) !== "created") {
      return null;
    }
    const pullRequest = getStringRecord(root.pull_request);
    const comment = getStringRecord(root.comment);
    const pullRequestNumber = getPositiveInt(pullRequest?.number);
    const commentId = getPositiveInt(comment?.id);
    const body = getString(comment?.body);
    if (!pullRequestNumber || !commentId || !body) {
      return null;
    }
    return {
      eventName: "pull_request_review_comment",
      sourceKind: "review_comment",
      repoFullName,
      issueNumber: pullRequestNumber,
      pullRequestNumber,
      actorLogin: senderLogin,
      actorId: String(senderId),
      body,
      commentId,
      messageId: `review-comment:${commentId}`,
      htmlUrl: getString(comment?.html_url) ?? undefined,
      threadTarget: `${repoFullName}#${pullRequestNumber}`,
    };
  }

  if (eventName === "pull_request_review") {
    if (getString(root.action) !== "submitted") {
      return null;
    }
    const pullRequest = getStringRecord(root.pull_request);
    const review = getStringRecord(root.review);
    const pullRequestNumber = getPositiveInt(pullRequest?.number);
    const reviewId = getPositiveInt(review?.id);
    const body = getString(review?.body);
    if (!pullRequestNumber || !reviewId || !body) {
      return null;
    }
    return {
      eventName: "pull_request_review",
      sourceKind: "review",
      repoFullName,
      issueNumber: pullRequestNumber,
      pullRequestNumber,
      actorLogin: senderLogin,
      actorId: String(senderId),
      body,
      reviewId,
      messageId: `review:${reviewId}`,
      htmlUrl: getString(review?.html_url) ?? undefined,
      threadTarget: `${repoFullName}#${pullRequestNumber}`,
    };
  }

  return null;
}

export function detectGitHubMentions(params: { body: string; botLogin?: string }): {
  hasAnyMention: boolean;
  wasMentioned: boolean;
  canDetectMention: boolean;
} {
  const mentions = Array.from(params.body.matchAll(/(^|[^a-z0-9_-])@([a-z0-9-]{1,39})/gi)).map(
    (match) => match[2]?.toLowerCase(),
  );
  const hasAnyMention = mentions.length > 0;
  const normalizedBotLogin = params.botLogin?.trim().replace(/^@/, "").toLowerCase();
  if (!normalizedBotLogin) {
    return {
      hasAnyMention,
      wasMentioned: false,
      canDetectMention: false,
    };
  }
  return {
    hasAnyMention,
    wasMentioned: mentions.includes(normalizedBotLogin),
    canDetectMention: true,
  };
}

async function deliverGitHubReply(params: {
  payload: { text?: string; mediaUrls?: string[]; mediaUrl?: string; replyToId?: string };
  event: GitHubInboundEvent;
  target: GitHubInboundTarget;
}) {
  const { payload, event, target } = params;
  const text = payload.text ?? "";
  const mediaList = payload.mediaUrls?.length
    ? payload.mediaUrls
    : payload.mediaUrl
      ? [payload.mediaUrl]
      : [];

  if (!text.trim() && mediaList.length === 0) {
    return;
  }

  const mediaSuffix = mediaList.length
    ? `\n\n${mediaList.map((url) => `Attachment: ${url}`).join("\n")}`
    : "";
  const combined = `${text.trim()}${mediaSuffix}`.trim();
  if (!combined) {
    return;
  }

  const chunkLimit = target.account.config.textChunkLimit ?? 60000;
  const chunkMode = target.core.channel.text.resolveChunkMode(
    target.config,
    CHANNEL_ID,
    target.account.accountId,
  );
  const tableMode = target.core.channel.text.resolveMarkdownTableMode({
    cfg: target.config,
    channel: CHANNEL_ID,
    accountId: target.account.accountId,
  });
  const normalized = target.core.channel.text.convertMarkdownTables(combined, tableMode);
  const chunks = target.core.channel.text.chunkMarkdownTextWithMode(
    normalized,
    chunkLimit,
    chunkMode,
  );

  const inboundReplyTarget =
    event.sourceKind === "review_comment" && event.pullRequestNumber && event.commentId
      ? { pullRequestNumber: event.pullRequestNumber, commentId: event.commentId }
      : null;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const replyId = payload.replyToId ? Number.parseInt(payload.replyToId, 10) : Number.NaN;
    const resolvedReplyId = Number.isInteger(replyId) && replyId > 0 ? replyId : undefined;
    const reviewReplyCommentId = resolvedReplyId ?? inboundReplyTarget?.commentId;

    if (i === 0 && inboundReplyTarget && reviewReplyCommentId) {
      try {
        await sendGitHubReviewCommentReply({
          account: target.account,
          repoFullName: event.repoFullName,
          pullNumber: inboundReplyTarget.pullRequestNumber,
          commentId: reviewReplyCommentId,
          body: chunk,
        });
        target.statusSink?.({ lastOutboundAt: Date.now() });
        continue;
      } catch (error) {
        // Fallback to issue comments when review-thread replies are not allowed.
        target.runtime.error?.(
          `[${target.account.accountId}] github review reply failed, falling back to issue comment: ${String(error)}`,
        );
      }
    }

    await sendGitHubIssueComment({
      account: target.account,
      repoFullName: event.repoFullName,
      issueNumber: event.issueNumber,
      body: chunk,
    });
    target.statusSink?.({ lastOutboundAt: Date.now() });
  }
}

export async function handleGitHubInbound(params: {
  event: GitHubInboundEvent;
  target: GitHubInboundTarget;
}): Promise<void> {
  const { event, target } = params;
  const { account, config, core, runtime, statusSink } = target;
  const rawBody = event.body.trim();
  if (!rawBody) {
    return;
  }

  statusSink?.({ lastInboundAt: Date.now() });

  const normalizedBotLogin = account.config.botLogin?.trim().replace(/^@/, "").toLowerCase();
  if (normalizedBotLogin && event.actorLogin.toLowerCase() === normalizedBotLogin) {
    return;
  }

  const repoPolicy = resolveGitHubRepositoryPolicy({
    config: account.config,
    repoFullName: event.repoFullName,
  });
  if (!repoPolicy.enabled) {
    runtime.log?.(`github: drop ${event.threadTarget} (repository disabled)`);
    return;
  }

  const actorAllowed = isGitHubActorAllowed({
    allowFrom: repoPolicy.allowFrom,
    actorLogin: event.actorLogin,
    actorId: event.actorId,
  });
  if (!actorAllowed.allowed) {
    runtime.log?.(
      `github: drop sender @${event.actorLogin} for ${event.threadTarget} (allowFrom mismatch)`,
    );
    return;
  }

  const allowTextCommands = core.channel.commands.shouldHandleTextCommands({
    cfg: config,
    surface: CHANNEL_ID,
  });
  const hasControlCommand = core.channel.text.hasControlCommand(rawBody, config);
  const useAccessGroups =
    (config.commands as { useAccessGroups?: boolean } | undefined)?.useAccessGroups !== false;
  const commandGate = resolveControlCommandGate({
    useAccessGroups,
    authorizers: [
      {
        configured: repoPolicy.allowFrom.length > 0,
        allowed: actorAllowed.allowed,
      },
    ],
    allowTextCommands,
    hasControlCommand,
  });
  if (commandGate.shouldBlock) {
    logInboundDrop({
      log: (line) => runtime.log?.(line),
      channel: CHANNEL_ID,
      reason: "control command (unauthorized)",
      target: event.actorLogin,
    });
    return;
  }

  const mentionRegexes = core.channel.mentions.buildMentionRegexes(config);
  const mentionFromPatterns =
    mentionRegexes.length > 0
      ? core.channel.mentions.matchesMentionPatterns(rawBody, mentionRegexes)
      : false;
  const mentionDetection = detectGitHubMentions({
    body: rawBody,
    botLogin: account.config.botLogin,
  });
  const wasMentioned = mentionFromPatterns || mentionDetection.wasMentioned;
  if (
    repoPolicy.requireMention &&
    !mentionDetection.canDetectMention &&
    mentionRegexes.length === 0
  ) {
    runtime.log?.(
      `github: drop ${event.threadTarget} (requireMention=true but botLogin/mentions are not configured)`,
    );
    return;
  }

  const mentionGate = resolveMentionGatingWithBypass({
    isGroup: true,
    requireMention: repoPolicy.requireMention,
    canDetectMention: mentionDetection.canDetectMention || mentionRegexes.length > 0,
    wasMentioned,
    hasAnyMention: mentionDetection.hasAnyMention,
    allowTextCommands,
    hasControlCommand,
    commandAuthorized: commandGate.commandAuthorized,
  });
  if (mentionGate.shouldSkip) {
    runtime.log?.(`github: drop ${event.threadTarget} (mention required)`);
    return;
  }

  if (event.commentId && account.config.events?.issueComment !== false) {
    try {
      await addGitHubCommentReaction({
        account,
        repoFullName: event.repoFullName,
        commentId: event.commentId,
        reaction: "eyes",
      });
    } catch {
      // Reaction add failure should never block message processing.
    }
  }

  const route = core.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: {
      kind: "group",
      id: event.threadTarget,
    },
  });

  const fromLabel = `${event.repoFullName}#${event.issueNumber} by @${event.actorLogin}`;
  const storePath = core.channel.session.resolveStorePath(config.session?.store, {
    agentId: route.agentId,
  });
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(config);
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "GitHub",
    from: fromLabel,
    timestamp: Date.now(),
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    BodyForAgent: rawBody,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: `github:${event.actorLogin}`,
    To: `github:${event.threadTarget}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: "channel",
    ConversationLabel: event.threadTarget,
    SenderName: event.actorLogin,
    SenderId: event.actorId,
    SenderUsername: event.actorLogin,
    WasMentioned: mentionGate.effectiveWasMentioned,
    CommandAuthorized: commandGate.commandAuthorized,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    MessageSid: event.messageId,
    MessageSidFull: event.messageId,
    ReplyToId: event.commentId ? String(event.commentId) : undefined,
    ReplyToIdFull: event.commentId ? String(event.commentId) : undefined,
    GroupSpace: event.repoFullName,
    GroupChannel: `#${event.issueNumber}`,
    GroupSystemPrompt: repoPolicy.systemPrompt,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: `github:${event.threadTarget}`,
  });

  void core.channel.session
    .recordSessionMetaFromInbound({
      storePath,
      sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
      ctx: ctxPayload,
    })
    .catch((error) => {
      runtime.error?.(`github: failed updating session meta: ${String(error)}`);
    });

  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg: config,
    agentId: route.agentId,
    channel: CHANNEL_ID,
    accountId: route.accountId,
  });

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config,
    dispatcherOptions: {
      ...prefixOptions,
      deliver: async (payload) => {
        await deliverGitHubReply({
          payload,
          event,
          target,
        });
      },
      onError: (error, info) => {
        runtime.error?.(
          `[${account.accountId}] github ${info.kind} reply failed for ${event.threadTarget}: ${String(error)}`,
        );
      },
    },
    replyOptions: {
      onModelSelected,
    },
  });
}
