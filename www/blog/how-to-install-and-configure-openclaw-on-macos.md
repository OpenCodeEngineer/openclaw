---
title: "How to Install and Configure OpenClaw on macOS"
description: "A practical guide to installing OpenClaw on your Mac, running the onboarding wizard, understanding the LaunchAgent service, and avoiding the most common macOS setup mistakes."
date: "2026-03-16"
author: "Dzianis Vashchuk"
authorUrl: "https://linkedin.com/in/dzianisv"
tags:
  - how-to
  - openclaw
  - macos
  - setup
  - launchagent
published: true
---

If you are setting up OpenClaw on a Mac for the first time, the official documentation points to two valid paths:

1. a CLI-first setup with `openclaw onboard --install-daemon`
2. a macOS app-first setup where the menu bar app manages the local Gateway

That sounds straightforward until you hit the question most people eventually ask:

**Which command should I actually use on macOS: `openclaw onboard --install-daemon` or `openclaw gateway install`?**

The short answer from the docs is:

- use `openclaw onboard --install-daemon` for first setup
- use `openclaw gateway install` when OpenClaw is already configured and you only need to install or repair the LaunchAgent

This guide follows the official docs and turns that into a practical macOS setup flow.

## What the official docs recommend

The official Getting Started guide uses this flow:

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
openclaw onboard --install-daemon
openclaw gateway status
openclaw dashboard
```

The official platform docs also say the onboarding wizard is the **recommended** way to install the Gateway service, while `openclaw gateway install` is the direct alternative if you already have configuration in place.

So if you want the least confusing answer, start with the wizard.

## Before you start

The docs currently recommend:

- Node 24 if you are installing and running OpenClaw from the CLI
- Node 22 LTS is still supported for compatibility
- Node is the recommended runtime on macOS
- Bun is not recommended for the Gateway

If you are using the macOS app as your main entry point, the app handles the native macOS side of the experience, but the CLI is still useful for status checks, configuration, and channels.

## Option 1: CLI-first setup on macOS

This is the cleanest path if you want the local Gateway, the Control UI, and a proper background service on your Mac.

### Step 1: Install OpenClaw

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
```

This is the install command shown in the official Getting Started guide for macOS and Linux.

### Step 2: Run the onboarding wizard

```bash
openclaw onboard --install-daemon
```

This is the most important command in the whole setup.

On macOS, the onboarding wizard is the recommended setup path because it handles much more than just the background service. According to the official docs, it walks you through:

- model and auth setup
- workspace location
- gateway port and auth mode
- optional channels
- daemon install
- health check
- skills

On macOS, the daemon step installs a per-user LaunchAgent.

### Step 3: Confirm the Gateway is up

```bash
openclaw gateway status
```

If you want a stricter check, use:

```bash
openclaw gateway status --deep --require-rpc
```

### Step 4: Open the Control UI

```bash
openclaw dashboard
```

This is the fastest way to get to a working first chat without setting up a messaging channel first.

## Option 2: macOS app-first setup

The official macOS docs also describe a stable workflow that starts with the app:

1. install and launch `OpenClaw.app`
2. complete the permissions checklist
3. keep the app in **Local** mode
4. let the app manage or attach to the local Gateway
5. optionally install and use the CLI

This is the better path if you care about native macOS capabilities like:

- notifications
- accessibility automation
- screen recording
- microphone and speech permissions
- AppleScript and Automation integrations

The macOS app is the part of the product that owns TCC permissions and acts as the native menu bar companion.

## One mental model that saves a lot of confusion

The persistent background service on macOS is the **Gateway**, not an always-on `openclaw agent` process.

That means the thing you install with LaunchAgent is the local Gateway service. Individual agent turns run through that Gateway.

Once you understand that, the command split makes much more sense.

## So when should you use `openclaw gateway install`?

Use it when OpenClaw is already configured and you only need to install or repair the macOS LaunchAgent.

That makes it useful for cases like:

- you already finished onboarding without the daemon step
- the LaunchAgent is missing
- you are repairing a local install
- you are configuring things manually and do not need the whole wizard again

In other words:

- `openclaw onboard --install-daemon` = first-time setup
- `openclaw gateway install` = direct service install

That is why both commands exist, even though they look redundant at first.

## What gets installed as the service on macOS

On macOS, OpenClaw uses a per-user LaunchAgent.

The official docs describe the label as:

- `ai.openclaw.gateway`
- or `ai.openclaw.<profile>` if you run a named profile

This is an important macOS detail: LaunchAgent means the Gateway starts for the logged-in user session. It is not the same as a system-wide LaunchDaemon.

So if you reboot the Mac and expect OpenClaw to run before login, that is not the default behavior. The normal expected behavior is: log in, then the LaunchAgent starts.

## The most common macOS setup mistakes

### 1. Thinking `openclaw gateway install` is the recommended first command

It works, but the docs recommend the wizard first because the wizard also configures auth, workspace, channels, health checks, and skills.

### 2. Putting API keys only in your shell profile

This is a classic LaunchAgent problem.

The official docs note that launchd services do not inherit your shell environment the way you might expect. If something works in an interactive shell but fails after reboot or relaunch, move those keys into:

```bash
~/.openclaw/.env
```

Or enable shell env import in config:

```json
{
  "env": {
    "shellEnv": {
      "enabled": true
    }
  }
}
```

### 3. Forgetting that the macOS app owns the permission prompts

If you want screen recording, microphone, Automation, or similar macOS capabilities, the app is the right place to grant those permissions. The official macOS docs are clear that permission grants are tied to the app's identity, path, and signature.

### 4. Storing state in cloud-synced folders

The macOS docs recommend keeping OpenClaw state in a local non-synced path like:

```bash
~/.openclaw
```

That helps avoid file lock and sync issues with sessions and credentials.

## Where your OpenClaw setup lives on a Mac

The official setup docs separate your personal state from the repo itself.

The main places to know are:

- workspace: `~/.openclaw/workspace`
- config: `~/.openclaw/openclaw.json`
- global env fallback: `~/.openclaw/.env`
- credentials: `~/.openclaw/credentials/`

That separation is useful because it means you can update OpenClaw without stuffing your personal prompts, workspace state, or credentials into the repo.

## The simplest recommended macOS recipe

If you just want a sane default setup, use this:

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
openclaw onboard --install-daemon
openclaw gateway status
openclaw dashboard
```

If you want the native Mac experience on top of that, install and launch `OpenClaw.app`, keep it in Local mode, and let it handle permissions and the local node experience.

If something looks off later, the official repair path is:

```bash
openclaw doctor
```

## Final takeaway

The official docs are actually consistent once you collapse them into one rule:

- use `openclaw onboard --install-daemon` to set up OpenClaw on your Mac
- use `openclaw gateway install` when you specifically need to install or repair the LaunchAgent
- use the macOS app when you want the best native permissions and Mac integration

That is the clean mental model.

And if you start there, the rest of the macOS setup feels much less mysterious.

## Official docs referenced

- [Getting Started](https://docs.openclaw.ai/start/getting-started)
- [Onboarding Wizard](https://docs.openclaw.ai/start/wizard)
- [Platforms](https://docs.openclaw.ai/platforms)
- [macOS App](https://docs.openclaw.ai/platforms/macos)
- [Setup](https://docs.openclaw.ai/start/setup)
- [Environment Variables](https://docs.openclaw.ai/help/environment)
