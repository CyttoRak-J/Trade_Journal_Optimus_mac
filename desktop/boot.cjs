// Entry point the desktop app launches instead of server.js directly.
// The app holds this process's stdin open; when the app exits for any
// reason (including a crash or being killed), stdin closes and the server
// shuts down with it, so nothing is left running in the background.
const path = require("path");
const { pathToFileURL } = require("url");

process.stdin.on("end", () => process.exit(0));
process.stdin.on("error", () => process.exit(0));
process.stdin.resume();

import(pathToFileURL(path.join(process.cwd(), "server.js")).href);
