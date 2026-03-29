import { describe, expect, it } from "vitest";
import {
  normalizeGitHubAllowEntry,
  normalizeGitHubMessagingTarget,
  parseGitHubConversationTarget,
} from "./targets.js";

describe("normalizeGitHubMessagingTarget", () => {
  it("normalizes provider-prefixed targets", () => {
    expect(normalizeGitHubMessagingTarget("github:OpenClaw/OpenClaw#42")).toBe(
      "openclaw/openclaw#42",
    );
  });

  it("supports pr-prefixed thread identifiers", () => {
    expect(normalizeGitHubMessagingTarget("openclaw/openclaw#pr:8")).toBe("openclaw/openclaw#8");
  });

  it("rejects malformed targets", () => {
    expect(normalizeGitHubMessagingTarget("openclaw/openclaw")).toBeNull();
    expect(normalizeGitHubMessagingTarget("openclaw/openclaw#x")).toBeNull();
  });
});

describe("parseGitHubConversationTarget", () => {
  it("parses repo and issue number", () => {
    expect(parseGitHubConversationTarget("OpenClaw/OpenClaw#123")).toEqual({
      repoFullName: "openclaw/openclaw",
      issueNumber: 123,
    });
  });
});

describe("normalizeGitHubAllowEntry", () => {
  it("normalizes prefixes and @usernames", () => {
    expect(normalizeGitHubAllowEntry("github:@OpenClawBot")).toBe("openclawbot");
  });
});
