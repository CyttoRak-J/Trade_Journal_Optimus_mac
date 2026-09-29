// Copies a directory, turning pnpm's symlinks/junctions into real files and
// skipping the dev database that Next's standalone output picks up.
// Links are resolved by hand because Next on Windows can emit file-type
// symlinks that point at directories, which fs.cpSync cannot stat.
const fs = require("fs");
const path = require("path");

function resolveLink(p) {
  const target = fs.readlinkSync(p);
  return path.resolve(path.dirname(p), target);
}

function copy(src, dest) {
  let lst = fs.lstatSync(src);
  while (lst.isSymbolicLink()) {
    src = resolveLink(src);
    lst = fs.lstatSync(src);
  }
  if (lst.isDirectory()) {
    if (/[\\/]apps[\\/]web[\\/]data$/.test(src)) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) copy(path.join(src, name), path.join(dest, name));
  } else {
    fs.copyFileSync(src, dest);
  }
}

function copyTree(from, to) {
  copy(path.resolve(from), path.resolve(to));
  hoistPnpm(path.join(path.resolve(to), "node_modules"));
}

// Once links are real folders, pnpm's sibling-dependency layout no longer
// resolves. Hoist every package from node_modules/.pnpm into a flat
// node_modules so Node finds them by walking up the tree.
function hoistPnpm(nm) {
  const store = path.join(nm, ".pnpm");
  if (!fs.existsSync(store)) return;
  const hoist = (src, name) => {
    const dest = path.join(nm, name);
    if (!fs.existsSync(dest)) copy(src, dest);
  };
  for (const entry of fs.readdirSync(store)) {
    const inner = path.join(store, entry, "node_modules");
    if (!fs.existsSync(inner)) continue;
    for (const name of fs.readdirSync(inner)) {
      if (name.startsWith("@")) {
        for (const sub of fs.readdirSync(path.join(inner, name))) hoist(path.join(inner, name, sub), `${name}/${sub}`);
      } else {
        hoist(path.join(inner, name), name);
      }
    }
  }
  fs.rmSync(store, { recursive: true, force: true });
}

module.exports = { copyTree };

if (require.main === module) {
  const [from, to] = process.argv.slice(2);
  copyTree(from, to);
}
