import { defineBundledChannelEntry } from "openclaw/plugin-sdk/channel-entry-contract";

export default defineBundledChannelEntry({
  id: "telegram",
  name: "Telegram",
  description: "Telegram channel plugin",
  importMetaUrl: import.meta.url,
  plugin: {
    specifier: "./channel-plugin-api.js",
    exportName: "telegramPlugin",
  },
  secrets: {
    specifier: "./secret-contract-api.js",
    exportName: "channelSecrets",
  },
  runtime: {
    specifier: "./runtime-api.js",
    exportName: "setTelegramRuntime",
  },
  async registerFull(api) {
    const { createProxyIngressHandler } = await import("./src/proxy-ingress.js");
    const handler = createProxyIngressHandler(api);
    api.registerHttpRoute({
      path: "/api/channels/telegram/proxy-ingress",
      auth: "gateway",
      match: "exact",
      handler,
    });
  },
});
