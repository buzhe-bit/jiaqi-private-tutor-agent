import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";

import { createApp } from "./app.mjs";
import { createCoach } from "./coach/providers.mjs";
import { loadConfig } from "./config.mjs";
import { createLearningStore, createRecorder } from "./records/index.mjs";


const PUBLIC_ROOT = new URL("../public/", import.meta.url);
const STATIC_FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/styles.css", "styles.css"],
  ["/pilot.css", "pilot.css"],
  ["/app.js", "app.js"],
  ["/history-store.js", "history-store.js"],
  ["/request-route.js", "request-route.js"],
  ["/assets/plum-progress-final.png", "assets/plum-progress-final.png"],
  ["/assets/icons/message-circle-more.svg", "assets/icons/message-circle-more.svg"],
  ["/assets/icons/book-open.svg", "assets/icons/book-open.svg"],
  ["/assets/icons/pen-tool.svg", "assets/icons/pen-tool.svg"]
]);
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};
const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY"
};


async function requestBody(request, limit = 512 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("请求内容过大"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}


async function toWebRequest(request) {
  const origin = `http://${request.headers.host || "localhost"}`;
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await requestBody(request);
  return new Request(new URL(request.url || "/", origin), {
    method: request.method,
    headers: request.headers,
    body: body?.length ? body : undefined
  });
}


async function sendWebResponse(response, outgoing) {
  outgoing.statusCode = response.status;
  for (const [name, value] of response.headers) outgoing.setHeader(name, value);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) outgoing.setHeader(name, value);
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}


async function serveStatic(pathname, outgoing, searchParams) {
  const filename = STATIC_FILES.get(pathname);
  if (!filename) return false;
  let body = await readFile(new URL(filename, PUBLIC_ROOT));
  const preview = filename === "index.html" ? searchParams?.get("preview") : "";
  if (preview) {
    const suffix = `&preview=${encodeURIComponent(preview)}`;
    const encodedPreview = encodeURIComponent(preview);
    body = Buffer.from(body.toString()
      .replace(/(["']\/(?:styles\.css|app\.js)\?[^"']+)/g, `$1${suffix}`)
      .replace(/(["']\/assets\/plum-progress-final\.png)(["'])/g, `$1?preview=${encodedPreview}$2`));
  }
  outgoing.statusCode = 200;
  outgoing.setHeader("content-type", CONTENT_TYPES[extname(filename)] || "application/octet-stream");
  outgoing.setHeader("cache-control", filename === "index.html" ? "no-store" : "public, max-age=300");
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) outgoing.setHeader(name, value);
  outgoing.end(body);
  return true;
}


export function createHttpServer({ app }) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      if (url.pathname.startsWith("/api/") || url.pathname === "/pilot" || url.pathname.startsWith("/pilot/")) {
        await sendWebResponse(await app.handle(await toWebRequest(request)), response);
        return;
      }
      if (request.method === "GET" && await serveStatic(url.pathname, response, url.searchParams)) return;
      response.statusCode = 404;
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
      response.end("Not found");
    } catch (error) {
      response.statusCode = Number(error.status) || 500;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ error: response.statusCode >= 500 ? "服务暂时不可用" : error.message }));
    }
  });
}


export function startServer(env = process.env) {
  const config = loadConfig(env);
  const app = createApp({
    config,
    coach: createCoach(config),
    recorder: createRecorder(config),
    learningStore: createLearningStore(config)
  });
  const server = createHttpServer({ app });
  server.listen(config.port, "0.0.0.0", () => {
    console.log(`哲学论述陪练已启动：http://localhost:${config.port}/?invite=demo`);
  });
  return server;
}


if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
