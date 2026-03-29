import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { makeTempWorkspace } from "../test-helpers/workspace.js";
import { captureEnv } from "../test-utils/env.js";
import { createThrowingRuntime, readJsonFile } from "./onboard-non-interactive.test-helpers.js";

const ensureWorkspaceAndSessionsMock = vi.fn(async (..._args: unknown[]) => {});

vi.mock("./onboard-helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./onboard-helpers.js")>();
  return {
    ...actual,
    ensureWorkspaceAndSessions: ensureWorkspaceAndSessionsMock,
  };
});

const { runNonInteractiveOnboarding } = await import("./onboard-non-interactive.js");
const { resolveConfigPath: resolveStateConfigPath } = await import("../config/paths.js");

const runtime = createThrowingRuntime();

describe("onboard (non-interactive): Telegram bootstrap", () => {
  let envSnapshot: ReturnType<typeof captureEnv>;
  let tempHome: string | undefined;

  const initStateDir = async (prefix: string) => {
    if (!tempHome) {
      throw new Error("temp home not initialized");
    }
    const stateDir = await fs.mkdtemp(path.join(tempHome, prefix));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    delete process.env.OPENCLAW_CONFIG_PATH;
    return stateDir;
  };

  beforeAll(async () => {
    envSnapshot = captureEnv([
      "HOME",
      "OPENCLAW_STATE_DIR",
      "OPENCLAW_CONFIG_PATH",
      "OPENCLAW_SKIP_CHANNELS",
      "OPENCLAW_SKIP_GMAIL_WATCHER",
      "OPENCLAW_SKIP_CRON",
      "OPENCLAW_SKIP_CANVAS_HOST",
      "OPENCLAW_SKIP_BROWSER_CONTROL_SERVER",
      "TELEGRAM_BOT_TOKEN",
    ]);
    process.env.OPENCLAW_SKIP_CHANNELS = "1";
    process.env.OPENCLAW_SKIP_GMAIL_WATCHER = "1";
    process.env.OPENCLAW_SKIP_CRON = "1";
    process.env.OPENCLAW_SKIP_CANVAS_HOST = "1";
    process.env.OPENCLAW_SKIP_BROWSER_CONTROL_SERVER = "1";
    tempHome = await makeTempWorkspace("openclaw-onboard-telegram-");
    process.env.HOME = tempHome;
  });

  afterAll(async () => {
    if (tempHome) {
      await fs.rm(tempHome, { recursive: true, force: true });
    }
    envSnapshot.restore();
  });

  it("stores Telegram token and pre-authorized owners in local config", async () => {
    const stateDir = await initStateDir("state-telegram-");
    const workspace = path.join(stateDir, "openclaw");

    await runNonInteractiveOnboarding(
      {
        nonInteractive: true,
        mode: "local",
        workspace,
        authChoice: "skip",
        skipSkills: true,
        skipHealth: true,
        installDaemon: false,
        gatewayBind: "loopback",
        telegramBotToken: "123456:abc",
        telegramOwner: ["12345", "67890"],
      },
      runtime,
    );

    const configPath = resolveStateConfigPath(process.env, stateDir);
    const cfg = await readJsonFile<{
      channels?: {
        telegram?: {
          enabled?: boolean;
          botToken?: string;
          dmPolicy?: string;
          allowFrom?: string[];
        };
      };
    }>(configPath);

    expect(cfg.channels?.telegram?.enabled).toBe(true);
    expect(cfg.channels?.telegram?.botToken).toBe("123456:abc");
    expect(cfg.channels?.telegram?.dmPolicy).toBe("pairing");
    expect(cfg.channels?.telegram?.allowFrom).toEqual(["12345", "67890"]);
  }, 60_000);

  it("stores TELEGRAM_BOT_TOKEN as a SecretRef in ref mode", async () => {
    const stateDir = await initStateDir("state-telegram-ref-");
    const workspace = path.join(stateDir, "openclaw");
    process.env.TELEGRAM_BOT_TOKEN = "123456:from-env";

    try {
      await runNonInteractiveOnboarding(
        {
          nonInteractive: true,
          mode: "local",
          workspace,
          authChoice: "skip",
          skipSkills: true,
          skipHealth: true,
          installDaemon: false,
          gatewayBind: "loopback",
          secretInputMode: "ref",
          telegramOwner: ["12345"],
        },
        runtime,
      );

      const configPath = resolveStateConfigPath(process.env, stateDir);
      const cfg = await readJsonFile<{
        channels?: {
          telegram?: {
            botToken?: { source?: string; provider?: string; id?: string };
            allowFrom?: string[];
          };
        };
      }>(configPath);

      expect(cfg.channels?.telegram?.botToken).toEqual({
        source: "env",
        provider: "default",
        id: "TELEGRAM_BOT_TOKEN",
      });
      expect(cfg.channels?.telegram?.allowFrom).toEqual(["12345"]);
    } finally {
      delete process.env.TELEGRAM_BOT_TOKEN;
    }
  }, 60_000);

  it("rejects Telegram bootstrap flags in remote mode", async () => {
    const stateDir = await initStateDir("state-telegram-remote-");
    await expect(
      runNonInteractiveOnboarding(
        {
          nonInteractive: true,
          mode: "remote",
          remoteUrl: "wss://gateway.example.test",
          authChoice: "skip",
          telegramOwner: ["12345"],
        },
        runtime,
      ),
    ).rejects.toThrow(/Telegram bootstrap flags are only supported/);
    await fs.rm(stateDir, { recursive: true, force: true });
  }, 60_000);
});
