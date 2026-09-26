// Starts a self-contained PostgreSQL server for local development.
// Data lives in ./.pgdata. Credentials here are development-only and match .env.example.
// For staging/production point DATABASE_URL at Supabase or a managed Postgres instead.
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";

const dataDir = path.resolve(".pgdata");
const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "harbor",
  password: "harbor_dev_only",
  port: 5433,
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C", "--lc-messages=C"],
});

const fresh = !existsSync(path.join(dataDir, "PG_VERSION"));
if (fresh) {
  console.log("[dev-db] initialising new cluster in .pgdata …");
  await pg.initialise();
}
await pg.start();
if (fresh) {
  await pg.createDatabase("harborfinance");
  console.log("[dev-db] created database harborfinance");
}
console.log("[dev-db] PostgreSQL ready on postgresql://localhost:5433/harborfinance (Ctrl+C to stop)");

const stop = async () => {
  console.log("\n[dev-db] stopping …");
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
