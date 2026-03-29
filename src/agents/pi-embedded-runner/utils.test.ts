import { describe, expect, it } from "vitest";
import { buildOpaqueErrorDiagnostic, isOpaqueErrorText } from "./utils.js";

describe("isOpaqueErrorText", () => {
  it("recognizes generic opaque error text", () => {
    expect(isOpaqueErrorText(undefined)).toBe(true);
    expect(isOpaqueErrorText("")).toBe(true);
    expect(isOpaqueErrorText("Unknown error")).toBe(true);
    expect(isOpaqueErrorText("[object Object]")).toBe(true);
    expect(isOpaqueErrorText("{}")).toBe(true);
    expect(isOpaqueErrorText("fetch failed")).toBe(false);
  });
});

describe("buildOpaqueErrorDiagnostic", () => {
  it("captures nested error shape for opaque error objects", () => {
    const cause = Object.assign(new Error("fetch failed"), {
      code: "ECONNRESET",
      syscall: "connect",
      hostname: "vibebrowser-dev.openai.azure.com",
    });
    const error = new Error("") as Error & { cause?: unknown; status?: number };
    error.status = 503;
    error.cause = cause;

    const diagnostic = buildOpaqueErrorDiagnostic(error);
    const opaqueError = diagnostic.meta.opaqueError as Record<string, unknown>;
    const opaqueCause = opaqueError.cause as Record<string, unknown>;

    expect(diagnostic.summary).toContain("status=503");
    expect(diagnostic.summary).toContain("cause{");
    expect(opaqueError.name).toBe("Error");
    expect(opaqueError.status).toBe(503);
    expect(opaqueCause.code).toBe("ECONNRESET");
    expect(opaqueCause.syscall).toBe("connect");
    expect(opaqueCause.hostname).toBe("vibebrowser-dev.openai.azure.com");
  });

  it("redacts secrets from string diagnostics", () => {
    const token = "sk-abcdefghijklmnopqrstuvwxyz123456";
    const diagnostic = buildOpaqueErrorDiagnostic(`Authorization: Bearer ${token}`);

    expect(diagnostic.summary).toContain("Bearer");
    expect(diagnostic.summary).not.toContain(token);
  });
});
