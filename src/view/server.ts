import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, appendFileSync, watch, type FSWatcher } from "node:fs";
import { join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { resolveRepoRoot } from "../shared/paths.js";
import { isoSeconds } from "../shared/events.js";
import { derive, type DerivedState, type RawEvent } from "./derive.js";

// install layout: this file compiles to dist/view/server.js
const installRoot = fileURLToPath(new URL("../../", import.meta.url));
const publicDir = join(installRoot, "src", "view", "public"); // html/css/js served straight from source (no frontend build)
const libDir = fileURLToPath(new URL("./", import.meta.url)); // dist/view — the shared pure modules the page imports
const d3Path = join(installRoot, "node_modules", "d3", "dist", "d3.min.js");

export interface ViewServer {
  server: Server;
  port: number;
  url: string;
  close: () => Promise<void>;
}

export interface StartOptions {
  repoRoot: string;
  port?: number;
  host?: string;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export function startServer(opts: StartOptions): Promise<ViewServer> {
  const codemapDir = join(opts.repoRoot, ".codemap");
  const eventsPath = join(codemapDir, "events.jsonl");
  const telemetryPath = join(codemapDir, "telemetry.jsonl");
  const clients = new Set<ServerResponse>();

  function readEvents(): RawEvent[] {
    if (!existsSync(eventsPath)) return [];
    const out: RawEvent[] = [];
    for (const line of readFileSync(eventsPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        // skip a partially-written trailing line
      }
    }
    return out;
  }

  const state = (): DerivedState => derive(readEvents());

  const server = createServer((req, res) => handle(req, res));

  function handle(req: IncomingMessage, res: ServerResponse): void {
    const url = (req.url || "/").split("?")[0];

    if (url === "/api/state") return sendJson(res, state());
    if (url === "/api/events") return openSse(res);
    if (url === "/api/telemetry" && req.method === "POST") return recordTelemetry(req, res);

    if (url === "/" || url === "/index.html") return sendFile(res, join(publicDir, "index.html"));
    if (url === "/app.js") return sendFile(res, join(publicDir, "app.js"));
    if (url === "/style.css") return sendFile(res, join(publicDir, "style.css"));
    if (url === "/lib/decay.js") return sendFile(res, join(libDir, "decay.js"));
    if (url === "/lib/hierarchy.js") return sendFile(res, join(libDir, "hierarchy.js"));
    if (url === "/lib/d3.min.js") return sendFile(res, d3Path);

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }

  function openSse(res: ServerResponse): void {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write("retry: 3000\n\n");
    res.write(`data: ${JSON.stringify(state())}\n\n`);
    clients.add(res);
    res.on("close", () => clients.delete(res));
  }

  function broadcast(): void {
    const frame = `data: ${JSON.stringify(state())}\n\n`;
    for (const res of clients) res.write(frame);
  }

  function recordTelemetry(req: IncomingMessage, res: ServerResponse): void {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let payload: unknown = null;
      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        payload = { raw: body };
      }
      try {
        mkdirSync(codemapDir, { recursive: true });
        const line = JSON.stringify({ ...(payload as object), server_ts: isoSeconds() });
        appendFileSync(telemetryPath, line + "\n");
      } catch {
        // telemetry is best-effort; never fail the request
      }
      res.writeHead(204);
      res.end();
    });
  }

  // watch events.jsonl for growth; debounce, then push fresh state to SSE clients.
  mkdirSync(codemapDir, { recursive: true });
  let lastSize = existsSync(eventsPath) ? statSync(eventsPath).size : 0;
  let timer: NodeJS.Timeout | null = null;
  const watcher: FSWatcher = watch(codemapDir, (_evt, filename) => {
    if (filename && filename !== "events.jsonl") return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const size = existsSync(eventsPath) ? statSync(eventsPath).size : 0;
      if (size <= lastSize) return; // only push on growth
      lastSize = size;
      broadcast();
    }, 300);
  });

  return new Promise((resolvePromise) => {
    server.listen(opts.port ?? 4177, opts.host ?? "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : (opts.port ?? 4177);
      const url = `http://localhost:${port}`;
      const close = () =>
        new Promise<void>((done) => {
          if (timer) clearTimeout(timer);
          watcher.close();
          for (const res of clients) res.end();
          clients.clear();
          server.close(() => done());
        });
      resolvePromise({ server, port, url, close });
    });
  });
}

function sendJson(res: ServerResponse, obj: unknown): void {
  const body = JSON.stringify(obj);
  res.writeHead(200, { "content-type": MIME[".json"] });
  res.end(body);
}

function sendFile(res: ServerResponse, path: string): void {
  if (!existsSync(path)) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
  res.end(readFileSync(path));
}

// ---- cli entry: codemap view [--repo <path>] [--port <n>] [--open] ----

export async function runView(argv: (string | undefined)[]): Promise<void> {
  const repoArg = flag(argv, "--repo");
  const portArg = flag(argv, "--port");
  const open = argv.includes("--open");
  const repoRoot = resolveRepoRoot(repoArg ? resolve(repoArg) : process.cwd());
  const port = portArg ? Number(portArg) : 4177;

  const { url } = await startServer({ repoRoot, port: Number.isFinite(port) ? port : 4177 });
  console.log(`codemap view -> ${url}  (repo: ${repoRoot})`);
  if (open && process.platform === "darwin") spawn("open", [url], { stdio: "ignore", detached: true }).unref();
}

function flag(args: (string | undefined)[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1 || i + 1 >= args.length) return undefined;
  return args[i + 1];
}
