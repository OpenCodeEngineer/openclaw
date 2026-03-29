# Local OpenClaw install notes

This document captures the local setup used for a workstation OpenClaw deployment with:

- explicit higher reasoning defaults
- a local `faster_whisper` transcription path for Telegram voice notes
- Google Workspace / Gmail access through `gws`
- locally installed OpenClaw skills for Gmail workflows

All examples below are safe placeholders. Do not commit real API keys, OAuth secrets, or mailbox data.

## 1. OpenClaw config file

Local user config lives at:

```bash
~/.openclaw/openclaw.json
```

If you want a local `gpt-5.4` model entry plus a higher default thinking level, use a config shape like this:

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "custom-openai": {
        "baseUrl": "https://<your-endpoint>/openai/v1",
        "apiKey": "<YOUR_API_KEY>",
        "api": "openai-responses",
        "models": [
          {
            "id": "gpt-5.4",
            "name": "gpt-5.4",
            "api": "openai-responses",
            "reasoning": true,
            "input": ["text"],
            "cost": {
              "input": 0,
              "output": 0,
              "cacheRead": 0,
              "cacheWrite": 0
            },
            "contextWindow": 16000,
            "maxTokens": 4096
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "custom-openai/gpt-5.4"
      },
      "models": {
        "custom-openai/gpt-5.4": {}
      },
      "thinkingDefault": "xhigh"
    }
  }
}
```

Notes:

- `agents.defaults.thinkingDefault` is the persistent reasoning knob.
- `agents.defaults.model.primary` selects the default model.
- `agents.defaults.models` should also include the model ref so it is available to the agent picker.

## 2. Local audio transcription for Telegram voice notes

The most reliable local setup here was not `whisper-cli` auto-detect. Instead, OpenClaw was configured to call an explicit wrapper around Python `faster_whisper`.

Why this matters:

- OpenClaw checks local audio backends before cloud/provider fallbacks.
- A broken local `whisper-cli` can get selected first and prevent successful transcription.
- An explicit `tools.media.audio.models` entry keeps transcription deterministic.

### 2.1 Install the Python package

Use any Python environment you control. Example:

```bash
python3 -m venv ~/.venv
~/.venv/bin/pip install --upgrade pip
~/.venv/bin/pip install faster-whisper
```

### 2.2 Create the wrapper

Create:

```bash
mkdir -p ~/.openclaw/bin
```

Save this as `~/.openclaw/bin/faster-whisper-transcribe.py`:

```python
#!/usr/bin/env python3
import argparse
import os
import sys

from faster_whisper import WhisperModel


def env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def main() -> int:
    parser = argparse.ArgumentParser(description="Transcribe audio with local faster_whisper")
    parser.add_argument("audio_path")
    parser.add_argument("--model", default=os.getenv("OPENCLAW_LOCAL_WHISPER_MODEL", os.getenv("FASTER_WHISPER_MODEL", "base")))
    parser.add_argument("--device", default=os.getenv("OPENCLAW_LOCAL_WHISPER_DEVICE", "cpu"))
    parser.add_argument(
        "--compute-type",
        dest="compute_type",
        default=os.getenv("OPENCLAW_LOCAL_WHISPER_COMPUTE_TYPE", "int8"),
    )
    parser.add_argument(
        "--beam-size",
        dest="beam_size",
        type=int,
        default=int(os.getenv("OPENCLAW_LOCAL_WHISPER_BEAM_SIZE", "5")),
    )
    parser.add_argument("--language", default=os.getenv("OPENCLAW_LOCAL_WHISPER_LANGUAGE") or None)
    parser.add_argument(
        "--vad-filter",
        dest="vad_filter",
        action="store_true",
        default=env_flag("OPENCLAW_LOCAL_WHISPER_VAD_FILTER", False),
    )
    args = parser.parse_args()

    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
    segments, _info = model.transcribe(
        args.audio_path,
        beam_size=args.beam_size,
        language=args.language,
        vad_filter=args.vad_filter,
    )
    text = " ".join(segment.text.strip() for segment in segments).strip()
    if text:
        sys.stdout.write(text)
        if not text.endswith("\n"):
            sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

Then make it executable:

```bash
chmod +x ~/.openclaw/bin/faster-whisper-transcribe.py
```

If `python3` on your `PATH` is not the environment where `faster-whisper` is installed, replace the shebang with the exact interpreter path from your virtualenv.

### 2.3 Point OpenClaw at the wrapper

Add this block to `~/.openclaw/openclaw.json`:

```json
{
  "tools": {
    "media": {
      "audio": {
        "enabled": true,
        "maxBytes": 20971520,
        "timeoutSeconds": 120,
        "models": [
          {
            "model": "base",
            "type": "cli",
            "command": "/Users/<user>/.openclaw/bin/faster-whisper-transcribe.py",
            "args": ["{{MediaPath}}"],
            "timeoutSeconds": 120
          }
        ]
      }
    }
  }
}
```

Use an absolute path for `command`. Do not rely on `~` expansion inside JSON.

Useful optional environment overrides for the wrapper:

```bash
export OPENCLAW_LOCAL_WHISPER_MODEL=base
export OPENCLAW_LOCAL_WHISPER_DEVICE=cpu
export OPENCLAW_LOCAL_WHISPER_COMPUTE_TYPE=int8
export OPENCLAW_LOCAL_WHISPER_BEAM_SIZE=5
export OPENCLAW_LOCAL_WHISPER_LANGUAGE=
export OPENCLAW_LOCAL_WHISPER_VAD_FILTER=false
```

### 2.4 Smoke test the wrapper

Before testing Telegram, validate the wrapper directly:

```bash
~/.openclaw/bin/faster-whisper-transcribe.py /path/to/sample.ogg
```

Then send a short Telegram voice note to the bot and confirm OpenClaw now receives usable transcript text instead of silently failing on local backend auto-detect.

## 3. Restarting local OpenClaw

After config changes:

```bash
openclaw gateway restart
openclaw gateway status --deep --require-rpc
```

If the RPC probe is healthy, the gateway restart worked.

## 4. No-sudo OpenClaw upgrade and browser auto-connect

This workstation uses a user-scoped OpenClaw install so upgrades do not require `sudo`.

### 4.1 Install OpenClaw into `~/.local`

```bash
npm i -g openclaw@latest --prefix "$HOME/.local"
```

This places the binary at:

```bash
~/.local/bin/openclaw
```

### 4.2 Prefer the user-scoped binary in new shells

Ensure your shell startup files prepend `~/.local/bin` ahead of older Homebrew Node bin paths.

`~/.zprofile`

```bash
eval "$(/opt/homebrew/bin/brew shellenv)"
export PATH="$HOME/.local/bin:$PATH"
```

`~/.zshrc`

```bash
export PATH=/opt/homebrew/Cellar/node/24.7.0/bin:$PATH
export PATH="$HOME/.local/bin:$PATH"
```

Smoke test in a fresh login shell:

```bash
zsh -lc 'which openclaw && openclaw --version'
```

Expected result on this machine:

```bash
/Users/engineer/.local/bin/openclaw
OpenClaw 2026.3.13
```

### 4.3 Reinstall the gateway service from the user-scoped OpenClaw

```bash
~/.local/bin/openclaw gateway install --force --port 18789 --runtime node
~/.local/bin/openclaw gateway start
~/.local/bin/openclaw gateway status
```

The launch agent should point to:

```bash
/Users/engineer/.local/lib/node_modules/openclaw/dist/index.js
```

### 4.4 Configure the default browser profile to attach to the working browser

The docs-aligned setup uses an `existing-session` profile and makes it the default profile.

Create the profile:

```bash
~/.local/bin/openclaw browser create-profile --name user --driver existing-session --color '#00AA00'
```

Then set the remaining config:

```bash
~/.local/bin/openclaw config set browser.enabled true
~/.local/bin/openclaw config set browser.profiles.user.attachOnly true
~/.local/bin/openclaw config set browser.profiles.user.driver existing-session
~/.local/bin/openclaw config set browser.defaultProfile user
~/.local/bin/openclaw config validate
```

Resulting config shape:

```json
{
  "browser": {
    "enabled": true,
    "defaultProfile": "user",
    "profiles": {
      "user": {
        "cdpPort": 18801,
        "driver": "existing-session",
        "attachOnly": true,
        "color": "#00AA00"
      }
    }
  }
}
```

### 4.5 What `--autoConnect` means here

OpenClaw does not expose a separate config key named `autoConnect` in `openclaw.json`.
For `driver: "existing-session"`, OpenClaw uses Chrome DevTools MCP auto-connect behavior internally.

In practice:

- keep the real browser open
- use the `user` profile as the default
- let OpenClaw attach to the active browser session

### 4.6 Verify the attached-browser setup

```bash
~/.local/bin/openclaw browser --browser-profile user start
~/.local/bin/openclaw browser --browser-profile user status --json
~/.local/bin/openclaw browser profiles --json
```

Expected status on this machine:

- `profile: user`
- `driver: existing-session`
- `transport: chrome-mcp`
- `running: true`

### 4.7 Current local result

The upgraded local setup now reports:

- gateway RPC probe: healthy
- default browser profile: `user`
- browser driver: `existing-session`
- browser transport: `chrome-mcp`
- attached tab count: non-zero when the browser is open

Note on built-in profiles in OpenClaw `2026.3.13`:

- `user` is the built-in attached-browser profile for the real signed-in browser session.
- `chrome-relay` is also built-in and remains visible for the extension relay flow.
- You do not need to delete `chrome-relay`; just keep `browser.defaultProfile` set to `user` so the attached-browser flow is the default.
- Use `chrome-relay` only if you explicitly want the Chrome extension relay path.

## 5. Google Workspace CLI (`gws`) for Gmail

### 4.1 Install the CLI

Homebrew:

```bash
brew install googleworkspace-cli
```

Quick sanity check:

```bash
gws --version
gws auth status
```

### 4.2 Create OAuth credentials

The most stable path was the manual desktop-client flow:

1. Open the target Google Cloud project.
2. In Google Auth Platform:
   - set audience type to `External`
   - keep publishing status as `Testing`
   - add your Google account under `Test users`
3. Enable the Gmail API.
4. Create an OAuth client:
   - type: `Desktop app`
5. Download the generated client JSON.
6. Save it to:

```bash
~/.config/gws/client_secret.json
```

You can also let `gws auth setup` help with project/API setup, but the manual downloaded JSON path is simpler and easier to reproduce.

### 4.3 Authenticate Gmail access

After `client_secret.json` is in place:

```bash
gws auth login --services gmail
```

If Google shows the unverified-app warning, continue only if you recognize the app/project you created.

### 4.4 Verify auth

Check saved auth state:

```bash
gws auth status
```

Smoke test with a safe profile read:

```bash
gws gmail users getProfile --params '{"userId":"me"}'
```

Helper command examples:

```bash
gws gmail +triage --max 5
gws gmail +send --to someone@example.com --subject "Test" --body "Hello from gws"
```

## 6. Install Gmail-related OpenClaw skills

Clone the upstream repo somewhere local:

```bash
git clone https://github.com/googleworkspace/cli.git ~/src/googleworkspace-cli
mkdir -p ~/.openclaw/skills
```

Then install the Gmail-oriented skills. Symlinks are easiest to keep updated:

```bash
ln -s ~/src/googleworkspace-cli/skills/gws-shared ~/.openclaw/skills/gws-shared
ln -s ~/src/googleworkspace-cli/skills/gws-gmail ~/.openclaw/skills/gws-gmail
ln -s ~/src/googleworkspace-cli/skills/gws-gmail-send ~/.openclaw/skills/gws-gmail-send
ln -s ~/src/googleworkspace-cli/skills/gws-gmail-triage ~/.openclaw/skills/gws-gmail-triage
ln -s ~/src/googleworkspace-cli/skills/gws-gmail-reply ~/.openclaw/skills/gws-gmail-reply
ln -s ~/src/googleworkspace-cli/skills/gws-gmail-reply-all ~/.openclaw/skills/gws-gmail-reply-all
ln -s ~/src/googleworkspace-cli/skills/gws-gmail-forward ~/.openclaw/skills/gws-gmail-forward
ln -s ~/src/googleworkspace-cli/skills/gws-gmail-watch ~/.openclaw/skills/gws-gmail-watch
```

If you prefer copies instead of symlinks:

```bash
cp -R ~/src/googleworkspace-cli/skills/gws-* ~/.openclaw/skills/
```

## 7. Troubleshooting notes

### Telegram voice notes still fail

- Confirm the wrapper runs directly on an `.ogg`.
- Confirm `tools.media.audio.models[0].command` points at the wrapper path.
- Confirm the gateway was restarted after editing config.
- If `whisper-cli` is installed but broken locally, keep the explicit audio model config so OpenClaw does not auto-select the wrong backend.

### `gws` says access is blocked

- Make sure the OAuth app is `External` and still in `Testing`.
- Make sure your Google account is listed under `Test users`.
- Confirm the client is a `Desktop app`, not a web client.

### `gws` auth exists but Gmail commands fail

- Run `gws auth status` and confirm:
  - `credential_source` is present
  - encrypted credentials exist
  - `token_valid` is `true`
- Make sure `gmail.googleapis.com` is enabled in the same project as the OAuth client.
