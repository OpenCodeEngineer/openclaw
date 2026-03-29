import {
  normalizeAllowFromEntries,
  setChannelDmPolicyWithAllowFrom,
  splitOnboardingEntries,
} from "../../../channels/plugins/onboarding/helpers.js";
import type { OpenClawConfig } from "../../../config/config.js";
import type { DmPolicy, SecretInput } from "../../../config/types.js";
import type { RuntimeEnv } from "../../../runtime.js";
import { resolveDefaultSecretProviderAlias } from "../../../secrets/ref-contract.js";
import type { OnboardOptions, SecretInputMode } from "../../onboard-types.js";

type TelegramBootstrapResult = {
  nextConfig: OpenClawConfig;
  configured: boolean;
  owners: string[];
  dmPolicy?: DmPolicy;
};

function normalizeSecretInputModeInput(
  mode: SecretInputMode | undefined,
): SecretInputMode | undefined {
  if (mode === "plaintext" || mode === "ref") {
    return mode;
  }
  return undefined;
}

function normalizeTelegramDmPolicyInput(value: string | undefined): DmPolicy | undefined {
  const trimmed = value?.trim();
  if (
    trimmed === "pairing" ||
    trimmed === "allowlist" ||
    trimmed === "open" ||
    trimmed === "disabled"
  ) {
    return trimmed;
  }
  return undefined;
}

async function resolveStoredTelegramBotToken(params: {
  opts: OnboardOptions;
  baseConfig: OpenClawConfig;
  runtime: RuntimeEnv;
}): Promise<{ storedValue?: SecretInput; credentialValue?: string } | null> {
  const secretInputMode = normalizeSecretInputModeInput(params.opts.secretInputMode);
  const flagToken = params.opts.telegramBotToken?.trim();
  const envToken = process.env.TELEGRAM_BOT_TOKEN?.trim();

  if (secretInputMode === "ref") {
    if (!envToken && flagToken) {
      params.runtime.error(
        [
          "--telegram-bot-token cannot be used with --secret-input-mode ref unless TELEGRAM_BOT_TOKEN is set in env.",
          "Set TELEGRAM_BOT_TOKEN in env and omit --telegram-bot-token, or use --secret-input-mode plaintext.",
        ].join("\n"),
      );
      params.runtime.exit(1);
      return null;
    }
    if (envToken) {
      return {
        storedValue: {
          source: "env",
          provider: resolveDefaultSecretProviderAlias(params.baseConfig, "env", {
            preferFirstProviderForSource: true,
          }),
          id: "TELEGRAM_BOT_TOKEN",
        },
        credentialValue: envToken,
      };
    }
    return {};
  }

  if (flagToken) {
    return { storedValue: flagToken, credentialValue: flagToken };
  }

  if (envToken) {
    return { storedValue: envToken, credentialValue: envToken };
  }

  return {};
}

export async function applyNonInteractiveTelegramConfig(params: {
  nextConfig: OpenClawConfig;
  opts: OnboardOptions;
  runtime: RuntimeEnv;
  baseConfig: OpenClawConfig;
}): Promise<TelegramBootstrapResult | null> {
  const ownerEntries = normalizeAllowFromEntries(
    (params.opts.telegramOwner ?? []).flatMap((value) => splitOnboardingEntries(value)),
  );
  const explicitDmPolicy = normalizeTelegramDmPolicyInput(params.opts.telegramDmPolicy);
  if (params.opts.telegramDmPolicy && !explicitDmPolicy) {
    params.runtime.error(
      'Invalid --telegram-dm-policy. Use "pairing", "allowlist", "open", or "disabled".',
    );
    params.runtime.exit(1);
    return null;
  }

  const wantsTelegramBootstrap =
    Boolean(params.opts.telegramBotToken?.trim()) || ownerEntries.length > 0;
  if (!wantsTelegramBootstrap && !explicitDmPolicy) {
    return {
      nextConfig: params.nextConfig,
      configured: false,
      owners: [],
    };
  }

  const telegramToken = await resolveStoredTelegramBotToken({
    opts: params.opts,
    baseConfig: params.baseConfig,
    runtime: params.runtime,
  });
  if (telegramToken === null) {
    return null;
  }

  let nextConfig: OpenClawConfig = {
    ...params.nextConfig,
    channels: {
      ...params.nextConfig.channels,
      telegram: {
        ...params.nextConfig.channels?.telegram,
        enabled: true,
        ...(telegramToken.storedValue
          ? { botToken: telegramToken.storedValue as unknown as string }
          : {}),
      },
    },
  };

  if (ownerEntries.length > 0) {
    const { resolveTelegramAllowFromEntries } =
      await import("../../../../extensions/telegram/src/setup-core.js");
    const resolvedOwners = await resolveTelegramAllowFromEntries({
      entries: ownerEntries,
      credentialValue: telegramToken.credentialValue,
    });
    const unresolved = resolvedOwners
      .filter((entry) => !entry.resolved || !entry.id)
      .map((entry) => entry.input);
    if (unresolved.length > 0) {
      params.runtime.error(
        [
          "Could not resolve Telegram owner ids.",
          `Unresolved: ${unresolved.join(", ")}`,
          telegramToken.credentialValue
            ? "Use numeric Telegram user ids or verify that the bot can resolve those usernames."
            : "Provide --telegram-bot-token (or TELEGRAM_BOT_TOKEN) so @username and t.me owners can resolve, or use numeric Telegram user ids.",
        ].join("\n"),
      );
      params.runtime.exit(1);
      return null;
    }
    const allowFrom = normalizeAllowFromEntries(resolvedOwners.map((entry) => entry.id ?? ""));
    nextConfig = {
      ...nextConfig,
      channels: {
        ...nextConfig.channels,
        telegram: {
          ...nextConfig.channels?.telegram,
          allowFrom,
        },
      },
    };
  }

  const dmPolicy = explicitDmPolicy;
  if (dmPolicy) {
    nextConfig = setChannelDmPolicyWithAllowFrom({
      cfg: nextConfig,
      channel: "telegram",
      dmPolicy,
    });
  }

  return {
    nextConfig,
    configured: true,
    owners: ownerEntries,
    dmPolicy,
  };
}
