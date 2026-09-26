// Development runner: builds the frontend, then watches HTML sources and
// browser JS (for the icon module), runs the Tailwind watcher and `next dev`.
// Extra CLI args are forwarded to `next dev`, e.g. `npm run dev -- -p 3100`.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { buildHtml, buildCss } from "./build-frontend.js";

const ROOT = process.cwd();
const children = [];
const run = (cmd, args, name) => {
  const p = spawn(cmd, args, { stdio: "inherit", env: process.env });
  p.on("exit", (code) => code && console.log(`[dev] ${name} exited with ${code}`));
  children.push(p);
};

await buildHtml();
fs.mkdirSync(path.join(ROOT, "public/vendor"), { recursive: true });
fs.copyFileSync(
  path.join(ROOT, "node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js"),
  path.join(ROOT, "public/vendor/lightweight-charts.standalone.js"),
);
console.log("[dev] frontend built");

let timer = null;
const rebuild = (reason) => {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      await buildHtml();
      console.log(`[dev] rebuilt pages (${reason})`);
    } catch (err) {
      console.error("[dev] frontend build failed:", err.message);
    }
  }, 120);
};
fs.watch(path.join(ROOT, "frontend"), { recursive: true }, (_e, f) => f && !f.startsWith("styles") && rebuild(f));
fs.watch(path.join(ROOT, "lib/content"), { recursive: true }, (_e, f) => rebuild(f));
fs.watch(path.join(ROOT, "public/assets/js"), { recursive: true }, (_e, f) => f && !f.endsWith("icon-data.js") && rebuild(f));

const css = buildCss({ watch: true });
run(css.cmd, css.args, "tailwind");
run(process.execPath, [path.join(ROOT, "node_modules/next/dist/bin/next"), "dev", ...process.argv.slice(2)], "next");

const stop = () => {
  children.forEach((c) => c.kill());
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
