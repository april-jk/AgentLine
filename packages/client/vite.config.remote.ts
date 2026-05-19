/**
 * Vite config for remote (static) client build.
 *
 * This builds a standalone static site that can be deployed to GitHub Pages.
 * It uses remote.html as the entry point instead of index.html.
 */

import { execSync } from "node:child_process";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig } from "vite";
import { cspPlugin } from "./vite-plugin-csp";

function getGitVersion(): string {
  try {
    return execSync("git describe --tags --always", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    })
      .trim()
      .replace(/^v/, "");
  } catch {
    return "dev";
  }
}

// Port for dev server (different from regular client to allow parallel dev)
const remoteDevPort = process.env.REMOTE_PORT
  ? Number.parseInt(process.env.REMOTE_PORT, 10)
  : 3403;
const remoteHostEnv =
  process.env.REMOTE_HOST?.trim() || process.env.VITE_HOST?.trim();
const remoteHost =
  remoteHostEnv === "true" ? true : remoteHostEnv ? remoteHostEnv : true;
const remoteBase = process.env.REMOTE_BASE?.trim() || "/remote/";
const remoteBasePrefix = remoteBase.replace(/\/+$/, "");

// In watch mode (staging), don't empty the output dir to avoid race conditions
const isWatchMode = process.argv.includes("--watch");

/**
 * Plugin to serve remote.html instead of index.html in dev mode.
 * This makes the dev server behave like the production build.
 * We need to intercept ALL HTML requests (for SPA routing), not just root.
 */
function serveRemoteHtml(): Plugin {
  return {
    name: "serve-remote-html",
    configureServer(server) {
      // Add middleware BEFORE Vite's internal middleware (no return statement)
      server.middlewares.use((req, _res, next) => {
        const originalUrl = req.url ?? "/";
        const hasRemotePrefix =
          originalUrl.startsWith("/remote/") || originalUrl === "/remote";
        const normalizedUrl = hasRemotePrefix
          ? originalUrl.slice("/remote".length) || "/"
          : originalUrl;

        // Skip actual file requests (assets, source files)
        if (
          normalizedUrl.startsWith("/@") || // Vite internal
          normalizedUrl.startsWith("/src/") || // Source files
          normalizedUrl.startsWith("/node_modules/") || // Node modules
          normalizedUrl.includes(".") // Files with extensions
        ) {
          return next();
        }

        // For SPA routes, serve remote.html
        // This handles /projects, /settings, etc.
        req.url =
          hasRemotePrefix && remoteBasePrefix === "/remote"
            ? "/remote/remote.html"
            : "/remote.html";
        next();
      });
    },
  };
}

export default defineConfig({
  clearScreen: false,
  base: remoteBase,
  plugins: [serveRemoteHtml(), react(), cspPlugin({ isRemote: true })],
  resolve: {
    conditions: ["source"],
  },
  // Define build-time constants
  define: {
    "import.meta.env.VITE_IS_REMOTE_CLIENT": JSON.stringify(true),
    __APP_VERSION__: JSON.stringify(getGitVersion()),
  },
  // Build configuration for static site
  build: {
    outDir: "dist-remote",
    emptyOutDir: !isWatchMode, // Don't empty in watch mode to avoid race conditions
    rollupOptions: {
      input: {
        main: resolve(__dirname, "remote.html"),
      },
    },
  },
  // Dev server configuration
  server: {
    // When REMOTE_PORT=0, let Vite pick an available port (for E2E tests)
    port: remoteDevPort === 0 ? undefined : remoteDevPort,
    strictPort: remoteDevPort !== 0,
    // Allow connections from any host (for LAN testing)
    host: remoteHost,
    // Allow these hosts to connect
    allowedHosts: ["localhost", "127.0.0.1", "10.0.2.2", ".agentline.com"],
  },
});
