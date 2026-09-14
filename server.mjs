// Calcio Live — server locale: static + espn-pp-cli
// Il CLI (printing-press library) passa il WAF ESPN che blocca i client browser da questa rete.
// Le route /api/* mappano gli endpoint ESPN che usa app.js ai comandi del CLI.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";

const root = path.dirname(fileURLToPath(import.meta.url));
const ESPN_CLI = process.env.ESPN_CLI || path.join(os.homedir(), "printing-press", "library", "espn", "bin", process.platform === "win32" ? "espn-pp-cli.exe" : "espn-pp-cli");

// app.js usa solo questi tre endpoint; tutto il resto è 501.
function cliRoute(p, q) {
  let m;
  if ((m = p.match(/^\/api\/apis\/site\/v2\/sports\/(s[a-z]+)\/([a-z0-9.]+)\/scoreboard$/))) {
    const args = [m[1], m[2]];
    if (q.get("dates")) args.push("--dates", q.get("dates"));
    if (q.get("limit")) args.push("--limit", q.get("limit"));
    return { cmd: "scoreboard", args };
  }
  if ((m = p.match(/^\/api\/apis\/site\/v2\/sports\/(s[a-z]+)\/([a-z0-9.]+)\/summary$/)) && q.get("event"))
    return { cmd: "summary", args: [m[1], m[2], "--event", q.get("event")] };
  if ((m = p.match(/^\/api\/apis\/v2\/sports\/(s[a-z]+)\/([a-z0-9.]+)\/standings$/)))
    return { cmd: "standings", args: [m[1], m[2]] };
  return null;
}

function cliRun(args) {
  return new Promise((resolve, reject) => {
    execFile(
      ESPN_CLI,
      [...args, "--json", "--no-input", "--no-color", "--no-learn"],
      { maxBuffer: 64 * 1024 * 1024, timeout: 90_000 },
      (err, stdout) =>
        err ? reject(new Error(`espn-pp-cli ${args[0]}: ${err.message}`)) : resolve(stdout),
    );
  });
}

export function start(port = 8080) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://x");
      if (url.pathname.startsWith("/api/")) {
        const route = cliRoute(url.pathname, url.searchParams);
        if (!route) {
          res.writeHead(501, { "content-type": "text/plain" });
          return res.end("nessuna route CLI per " + url.pathname);
        }
        try {
          const out = await cliRun([route.cmd, ...route.args]);
          let payload = out, ctype = "text/plain";
          try {
            const data = JSON.parse(out);
            // il CLI wrappa {meta, results}; app.js vuole il payload ESPN crudo
            payload = data && data.meta && "results" in data ? data.results : data;
            ctype = "application/json";
          } catch {}
          res.writeHead(200, { "content-type": ctype });
          res.end(JSON.stringify(payload));
        } catch (e) {
          res.writeHead(502, { "content-type": "text/plain" });
          res.end(e.message);
        }
        return;
      }
      const file = url.pathname === "/" ? "/index.html" : url.pathname;
      const fp = path.normalize(path.join(root, file));
      if (!fp.startsWith(root)) { res.writeHead(403); return res.end(); }
      let body;
      try { body = fs.readFileSync(fp); } catch {
        res.writeHead(404, { "content-type": "text/plain" });
        return res.end("not found");
      }
      res.writeHead(200, { "content-type": fp.endsWith(".js") ? "text/javascript" : "text/html" });
      res.end(body);
    });
    srv.on("error", reject);
    srv.listen(port, "127.0.0.1", () => resolve(srv));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!fs.existsSync(ESPN_CLI)) {
    console.error(`espn-pp-cli non trovato: ${ESPN_CLI}\n(export ESPN_CLI=/path/to/espn-pp-cli)`);
    process.exit(1);
  }
  const srv = await start(Number(process.env.PORT) || 8080);
  console.log(`Calcio Live → http://localhost:${srv.address().port}`);
}
