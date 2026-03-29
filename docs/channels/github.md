---
summary: "GitHub issue/PR comment channel plugin setup and configuration"
read_when:
  - Working on GitHub channel setup
  - Wiring OpenClaw to repository workflows
title: "GitHub"
---

# GitHub (plugin)

Status: supported via plugin for webhook-driven issue + pull request comment workflows.

## Plugin required

GitHub is plugin-only and not enabled by default.

Install via npm:

```bash
openclaw plugins install @openclaw/github
```

Local checkout:

```bash
openclaw plugins install ./extensions/github
```

## What the channel handles

- `issue_comment` (`action=created`)
- `pull_request_review_comment` (`action=created`)
- `pull_request_review` (`action=submitted`, with non-empty body)

Replies are posted back to the same issue/PR thread.

## Quick setup

1. Create a GitHub App.
2. Configure repository permissions:
   - `Issues: Read & write`
   - `Pull requests: Read & write`
   - `Metadata: Read-only`
3. Subscribe to webhook events:
   - `Issue comment`
   - `Pull request review comment`
   - `Pull request review`
4. Set webhook URL to your gateway endpoint, for example:
   - `https://gateway.example.com/github`
5. Set a webhook secret in the app settings.
6. Create a token that can post comments (for now: PAT or App installation token provider feeding `channels.github.token`).
7. Configure OpenClaw:

```json5
{
  channels: {
    github: {
      enabled: true,
      webhookPath: "/github",
      webhookSecret: "replace-me",
      token: "github-access-token",
      botLogin: "openclaw-bot",
      requireMention: true,
      repositoryAllowlist: ["openclaw/openclaw"],
      allowFrom: ["core-maintainer", "release-manager"],
      repositories: {
        "openclaw/openclaw": {
          requireMention: true,
          systemPrompt: "Keep responses focused on code review and implementation details.",
        },
      },
    },
  },
}
```

## Security behavior

- If `webhookSecret` is configured, every webhook request is validated with `X-Hub-Signature-256`.
- If `allowFrom` is set, only listed users can trigger replies.
- If `requireMention` is true (default), comments must mention `@botLogin`.
- Repository filtering can be applied globally with `repositoryAllowlist` and per repo with `repositories`.

## Routing model

- Conversation key format: `owner/repo#number`
- All comments from the same issue/PR share one OpenClaw session for that target.
- Group policy and tool policy can be scoped per repository through `channels.github.repositories`.

## Troubleshooting

- `401 unauthorized`: webhook secret mismatch or missing signature header.
- `401 ambiguous webhook target`: multiple channel accounts resolve to the same webhook path and request.
- No response on mention:
  - verify `botLogin` matches the GitHub username exactly
  - check `allowFrom` and `repositoryAllowlist`
  - check `openclaw channels status --probe`
