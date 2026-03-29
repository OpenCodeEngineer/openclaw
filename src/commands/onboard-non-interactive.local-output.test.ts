import { describe, expect, it } from "vitest";
import { resolveNonInteractiveDashboardSummary } from "./onboard-non-interactive/local/output.js";

describe("resolveNonInteractiveDashboardSummary", () => {
  it("builds an auto-auth dashboard URL for config token auth", async () => {
    const summary = await resolveNonInteractiveDashboardSummary({
      config: {
        gateway: {
          bind: "loopback",
          port: 18789,
          auth: {
            mode: "token",
            token: "tok_local_123",
          },
        },
      },
      env: {},
    });

    expect(summary.url).toBe("http://127.0.0.1:18789/");
    expect(summary.autoAuthUrl).toBe("http://127.0.0.1:18789/#token=tok_local_123");
    expect(summary.tokenAutoAuthDisabledReason).toBeUndefined();
  });

  it("does not inline SecretRef-managed tokens", async () => {
    const summary = await resolveNonInteractiveDashboardSummary({
      config: {
        gateway: {
          bind: "loopback",
          port: 18789,
          auth: {
            mode: "token",
            token: { source: "env", provider: "default", id: "OPENCLAW_GATEWAY_TOKEN" },
          },
        },
      } as unknown as Parameters<typeof resolveNonInteractiveDashboardSummary>[0]["config"],
      env: {
        OPENCLAW_GATEWAY_TOKEN: "tok_env_123",
      },
    });

    expect(summary.url).toBe("http://127.0.0.1:18789/");
    expect(summary.autoAuthUrl).toBe("http://127.0.0.1:18789/");
    expect(summary.tokenAutoAuthDisabledReason).toMatch(/SecretRef-managed/);
  });
});
