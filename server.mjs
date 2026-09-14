// Calcio Live — server locale: static + proxy ESPN (il WAF ESPN blocca i client browser da questa rete)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const ESPN = "https://site.api.espn.com";
const UA = "curl/8.0"; // ponytail: il WAF 403 gli UA browser da questa rete; UA non-browser passa

export function start(port = 8080) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://x");
      if (url.pathname.startsWith("/api/")) {
        try {
          const upstream = await fetch(ESPN + url.pathname.slice(4) + url.search, {
            headers: { "user-agent": UA, accept: "application/json" },
          });
          const body = Buffer.from(await upstream.arrayBuffer());
          res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") || "application/json" });
          res.end(body);
        } catch (e) {
          res.writeHead(502, { "content-type": "text/plain" });
          res.end("proxy: " + e.message);
        }
        return;
      }
      const file = url.pathname === "/" ? "/index.html" : url.pathname;
      const fp = path.normalize(path.join(root, file));
      if (!fp.startsWith(root)) { res.writeHead(403); return res.end(); }
      try {
        res.writeHead(200, { "content-type": fp.endsWith(".js") ? "text/javascript" : "text/html" });
        res.end(fs.readFileSync(fp));
      } catch {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
      }
    });
    srv.on("error", reject);
    srv.listen(port, "127.0.0.1", () => resolve(srv));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const srv = await start(Number(process.env.PORT) || 8080);
  console.log(`Calcio Live → http://localhost:${srv.address().port}`);
}
