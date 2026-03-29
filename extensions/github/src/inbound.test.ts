import { describe, expect, it } from "vitest";
import { detectGitHubMentions, parseGitHubInboundEvent } from "./inbound.js";

describe("detectGitHubMentions", () => {
  it("detects explicit bot mention", () => {
    expect(
      detectGitHubMentions({ body: "please review @OpenClawBot", botLogin: "openclawbot" }),
    ).toEqual({
      hasAnyMention: true,
      wasMentioned: true,
      canDetectMention: true,
    });
  });

  it("reports mention presence when bot login is missing", () => {
    expect(detectGitHubMentions({ body: "cc @alice" })).toEqual({
      hasAnyMention: true,
      wasMentioned: false,
      canDetectMention: false,
    });
  });
});

describe("parseGitHubInboundEvent", () => {
  it("parses issue_comment events", () => {
    const parsed = parseGitHubInboundEvent("issue_comment", {
      action: "created",
      repository: { full_name: "openclaw/openclaw" },
      sender: { login: "alice", id: 1 },
      issue: { number: 42 },
      comment: { id: 1001, body: "hello", html_url: "https://example.com/comment" },
    });
    expect(parsed).toMatchObject({
      eventName: "issue_comment",
      sourceKind: "issue_comment",
      repoFullName: "openclaw/openclaw",
      issueNumber: 42,
      actorLogin: "alice",
      actorId: "1",
      body: "hello",
      commentId: 1001,
      threadTarget: "openclaw/openclaw#42",
    });
  });

  it("ignores unsupported actions", () => {
    expect(
      parseGitHubInboundEvent("issue_comment", {
        action: "edited",
        repository: { full_name: "openclaw/openclaw" },
        sender: { login: "alice", id: 1 },
        issue: { number: 42 },
        comment: { id: 1001, body: "hello" },
      }),
    ).toBeNull();
  });
});
