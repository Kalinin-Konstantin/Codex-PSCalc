import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../preview/", import.meta.url));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
const maxPortAttempts = 20;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

function createPreviewServer(currentPort) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${currentPort}`);
    const requested = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = normalize(join(root, requested));
    const headers = {
      "cache-control": "no-store, max-age=0",
      "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream"
    };

    if (!filePath.startsWith(root) || !existsSync(filePath)) {
      res.writeHead(404, { "cache-control": "no-store, max-age=0", "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    if (req.method === "HEAD") {
      res.writeHead(200, headers);
      res.end();
      return;
    }
    res.writeHead(200, headers);
    createReadStream(filePath).pipe(res);
  });
  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });
  return server;
}

function listen(nextPort, attemptsLeft = maxPortAttempts) {
  const server = createPreviewServer(nextPort);
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && attemptsLeft > 0 && !process.env.PORT) {
      listen(nextPort + 1, attemptsLeft - 1);
      return;
    }
    throw error;
  });

  server.listen(nextPort, host, () => {
    console.log(`Preview running at http://127.0.0.1:${nextPort}`);
  });
}

listen(port);
