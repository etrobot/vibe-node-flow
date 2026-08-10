import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { registerApiRoutes } from "./server/api";
import { loadNodePlugins, watchNodePlugins } from "./server/plugins";
import {
  startWorkflowScheduler,
  stopWorkflowScheduler,
} from "./server/scheduler";

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.use(express.json({ limit: "10mb" }));

  await loadNodePlugins();
  const stopNodePluginWatcher = watchNodePlugins();

  // All /api/* routes (workflows, execution, run history, LLM proxy).
  registerApiRoutes(app);
  await startWorkflowScheduler();

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Genno server running on http://localhost:${PORT}`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, stopping workflow scheduler...`);
    stopNodePluginWatcher();
    await stopWorkflowScheduler();
    server.close(() => process.exit(0));
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

startServer().catch((error) => {
  console.error("Failed to start Genno server:", error);
  process.exitCode = 1;
});
