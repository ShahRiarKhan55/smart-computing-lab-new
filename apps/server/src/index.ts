import "dotenv/config";
import { createApp } from "./app.js";
import { assertProductionConfig } from "./lib/config.js";
import { prisma } from "./lib/prisma.js";

assertProductionConfig();

const port = Number(process.env.PORT) || 4000;
const app = createApp();

const server = app.listen(port, () => {
  console.log(`SCL API server listening on http://localhost:${port}`);
});

// Graceful shutdown (Phase 26 §12): stop accepting new connections, let in-flight requests
// finish, then close the database connection — rather than the process dying mid-request or
// leaving the SQLite connection open. A second signal (or a shutdown that hangs) still lets the
// process exit rather than blocking a deploy/restart forever.
let shuttingDown = false;
function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] received ${signal}, shutting down…`);
  const forceExit = setTimeout(() => {
    console.error("[server] shutdown timed out; forcing exit.");
    process.exit(1);
  }, 10_000);
  forceExit.unref();
  server.close(async (err) => {
    if (err) console.error("[server] error while closing HTTP server:", err);
    try {
      await prisma.$disconnect();
    } catch (disconnectErr) {
      console.error("[server] error while disconnecting Prisma:", disconnectErr);
    }
    clearTimeout(forceExit);
    process.exit(err ? 1 : 0);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
