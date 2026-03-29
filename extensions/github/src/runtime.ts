import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setGitHubRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getGitHubRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("GitHub runtime not initialized");
  }
  return runtime;
}
