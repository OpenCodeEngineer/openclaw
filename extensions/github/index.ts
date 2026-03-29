import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { githubPlugin } from "./src/channel.js";
import { handleGitHubWebhookRequest } from "./src/monitor.js";
import { setGitHubRuntime } from "./src/runtime.js";

const plugin = {
  id: "github",
  name: "GitHub",
  description: "OpenClaw GitHub channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setGitHubRuntime(api.runtime);
    api.registerChannel({ plugin: githubPlugin });
    api.registerHttpRoute({
      path: "/github",
      auth: "plugin",
      handler: async (req, res) => {
        const handled = await handleGitHubWebhookRequest(req, res);
        if (handled) {
          return;
        }
        res.statusCode = 404;
        res.end("Not Found");
      },
    });
  },
};

export default plugin;
