// Stages everything the desktop app ships besides its own binary:
//   src-tauri/resources/server   Next.js standalone server (flattened node_modules)
//   src-tauri/resources/runtime  the Node binary that built it (same ABI as better-sqlite3)
//   src-tauri/resources/boot.cjs server entry that exits when the app does
// Run after `pnpm build` at the repo root.
const fs = require("fs");
const path = require("path");
const { copyTree } = require("../scripts/copy-tree.cjs");

const repo = path.resolve(__dirname, "..");
const web = path.join(repo, "apps", "web");
const standalone = path.join(web, ".next", "standalone");
const out = path.join(__dirname, "src-tauri", "resources");

if (!fs.existsSync(path.join(standalone, "apps", "web", "server.js"))) {
  console.error("No standalone build found. Run `pnpm build` at the repo root first.");
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
const server = path.join(out, "server");
copyTree(standalone, server);
copyTree(path.join(web, ".next", "static"), path.join(server, "apps", "web", ".next", "static"));
copyTree(path.join(web, "public"), path.join(server, "apps", "web", "public"));

const runtime = path.join(out, "runtime");
fs.mkdirSync(runtime, { recursive: true });
fs.copyFileSync(
  process.execPath,
  path.join(runtime, process.platform === "win32" ? "node.exe" : "node"),
);

fs.copyFileSync(path.join(__dirname, "boot.cjs"), path.join(out, "boot.cjs"));
console.log(`Staged desktop resources in ${out} (Node ${process.version})`);
