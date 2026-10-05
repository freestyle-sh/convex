import { readFileSync } from "node:fs";
import type { Server as HttpServer } from "node:http";
import { defineConfig, loadEnv } from "vite";
import type { PreviewServer, ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { attachTerminalProxy } from "./terminalProxy";

const onboardPath = new URL("../onboard.md", import.meta.url);

function attachOnboardRoute(
  server:
    Pick<ViteDevServer, "middlewares"> | Pick<PreviewServer, "middlewares">,
) {
  server.middlewares.use((request, response, next) => {
    if (request.url?.split("?", 1)[0] !== "/onboard.md") {
      next();
      return;
    }

    response.statusCode = 200;
    response.setHeader("Content-Type", "text/markdown; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache");
    response.end(readFileSync(onboardPath, "utf8"));
  });
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiKey = process.env.FREESTYLE_API_KEY ?? env.FREESTYLE_API_KEY;

  return {
    plugins: [
      react(),
      {
        name: "onboard-markdown",
        configureServer(server) {
          attachOnboardRoute(server);
        },
        configurePreviewServer(server) {
          attachOnboardRoute(server);
        },
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "onboard.md",
            source: readFileSync(onboardPath, "utf8"),
          });
        },
      },
      {
        name: "freestyle-terminal-proxy",
        configureServer(server) {
          if (server.httpServer) {
            attachTerminalProxy(server.httpServer as HttpServer, apiKey);
          }
        },
        configurePreviewServer(server) {
          if (server.httpServer) {
            attachTerminalProxy(server.httpServer as HttpServer, apiKey);
          }
        },
      },
    ],
  };
});
