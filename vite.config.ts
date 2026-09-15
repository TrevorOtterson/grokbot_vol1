import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, type UserConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  // Only treat HOST as an app URL when it looks like one (Shopify tunnel).
  // Bare bind addresses like 0.0.0.0 must not become SHOPIFY_APP_URL.
  const hostCandidate = process.env.HOST;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(hostCandidate)) {
    process.env.SHOPIFY_APP_URL = hostCandidate;
  }
  delete process.env.HOST;
}

const appUrl = process.env.SHOPIFY_APP_URL || "http://localhost";
const host = new URL(
  /^[a-z][a-z0-9+.-]*:\/\//i.test(appUrl) ? appUrl : `http://${appUrl}`,
).hostname;

let hmrConfig;
if (host === "localhost" || host === "127.0.0.1") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: parseInt(process.env.FRONTEND_PORT!) || 8002,
    clientPort: 443,
  };
}

export default defineConfig({
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    cors: {
      preflightContinue: true,
    },
    port: Number(process.env.PORT || 43173),
    hmr: hmrConfig,
    fs: {
      allow: ["app", "node_modules"],
    },
  },
  plugins: [reactRouter(), tsconfigPaths()],
  build: {
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    include: ["@shopify/app-bridge-react", "jsbarcode"],
  },
}) satisfies UserConfig;
