import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const silenceChromeDevtoolsProbe = {
  name: "silence-chrome-devtools-probe",
  configureServer(server: import("vite").ViteDevServer) {
    server.middlewares.use((req, res, next) => {
      if (req.url === "/.well-known/appspecific/com.chrome.devtools.json") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end("{}");
        return;
      }
      next();
    });
  },
};

export default defineConfig({
  plugins: [silenceChromeDevtoolsProbe, reactRouter(), tsconfigPaths()],
  css: {
    postcss: "./postcss.config.mjs"
  }
});
