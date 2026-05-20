const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const next = require("next");
const { attachOpenClawSshServer } = require("./openclaw-ssh");

const dir = path.join(__dirname, "..");
const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = Number.parseInt(process.env.PORT || "3000", 10);

process.chdir(dir);

function standaloneConfig() {
  if (dev) {
    return undefined;
  }

  try {
    const requiredServerFiles = JSON.parse(
      fs.readFileSync(path.join(dir, ".next", "required-server-files.json"), "utf8")
    );

    if (requiredServerFiles?.config) {
      process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(requiredServerFiles.config);
      return requiredServerFiles.config;
    }
  } catch {
    // Fall back to Next loading config from the project root.
  }

  return undefined;
}

const app = next({
  conf: standaloneConfig(),
  dev,
  dir,
  hostname,
  port
});
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = http.createServer((request, response) => {
    handle(request, response);
  });

  attachOpenClawSshServer(server);

  server.listen(port, hostname, () => {
    console.info(`[server] ready on http://${hostname}:${port}`);
  });
}).catch((error) => {
  console.error("[server] failed to start", error);
  process.exit(1);
});
