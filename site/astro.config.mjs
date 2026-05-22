import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

const base = process.env.SITE_BASE || "/";

export default defineConfig({
  site: "https://agentline.com",
  base,
  integrations: [sitemap()],
  devToolbar: {
    enabled: false,
  },
  build: {
    format: "file",
  },
  trailingSlash: "never",
  server: {
    port: 3000,
    host: true,
  },
});
