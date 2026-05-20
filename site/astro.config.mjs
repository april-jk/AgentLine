import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://agentline.com",
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
