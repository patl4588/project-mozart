#!/usr/bin/env node
/**
 * Programmable 2-Instance Non-Sticky Round-Robin + 502/TCP-Reset Chaos Proxy
 * for Operation Mozart QA Gatekeeper.
 */
import http from "node:http";

export function startSplitBrainChaosProxy({ targets = [], port = 0, host = "127.0.0.1" } = {}) {
  if (!Array.isArray(targets) || targets.length < 2) {
    throw new Error("startSplitBrainChaosProxy requires at least 2 upstream targets [A, B]");
  }

  let rrCounter = 0;
  const activeSseSockets = new Set();
  const faultState = {
    swap502UntilMs: 0,
    killSseAtChunkCount: 0,
    killedCount: 0,
  };
  const telemetry = {
    totalRequests: 0,
    routedA: 0,
    routedB: 0,
    status404: 0,
    status401: 0,
    status5xx: 0,
    conversationsCreated: 0,
    messagePosts: 0,
    sseConnectCursors: [],
    meRequests: 0,
  };

  const server = http.createServer(async (req, res) => {
    if (req.url === "/__qa_control" && req.method === "POST") {
      const buf = [];
      for await (const c of req) buf.push(c);
      const cmd = JSON.parse(Buffer.concat(buf).toString("utf8") || "{}");
      if (cmd.fault === "502_swap") {
        faultState.swap502UntilMs = Date.now() + Number(cmd.durationMs || 5000);
        for (const sock of activeSseSockets) {
          sock.destroy();
        }
        activeSseSockets.clear();
      } else if (cmd.fault === "tcp_reset_sse") {
        faultState.killSseAtChunkCount = Number(cmd.afterFrames || 4);
        faultState.killedCount = 0;
      } else if (cmd.fault === "reset_telemetry") {
        Object.assign(telemetry, {
          totalRequests: 0,
          routedA: 0,
          routedB: 0,
          status404: 0,
          status401: 0,
          status5xx: 0,
          conversationsCreated: 0,
          messagePosts: 0,
          sseConnectCursors: [],
          meRequests: 0,
        });
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, faultState, telemetry }));
      return;
    }

    if (req.url === "/__qa_telemetry" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ telemetry, faultState }));
      return;
    }

    telemetry.totalRequests += 1;
    const urlStr = req.url || "/";
    if (req.method === "POST" && /^\/api\/workspace\/conversations\/?$/.test(urlStr)) {
      telemetry.conversationsCreated += 1;
    }
    if (req.method === "POST" && /\/api\/workspace\/conversations\/[^/]+\/messages\/?$/.test(urlStr)) {
      telemetry.messagePosts += 1;
    }
    if (/^\/api\/workspace\/me\/?/.test(urlStr)) {
      telemetry.meRequests += 1;
    }
    const isSse = urlStr.includes("/stream") || String(req.headers.accept || "").includes("text/event-stream");
    if (isSse) {
      const parsed = new URL(urlStr, "http://127.0.0.1");
      const cursor =
        req.headers["last-event-id"] ||
        parsed.searchParams.get("after_seq") ||
        parsed.searchParams.get("after") ||
        "0";
      telemetry.sseConnectCursors.push(Number(cursor) || 0);
    }

    // Active 502 container-swap window fault injection (renders real HTML 502 like Cloudflare/Render)
    if (Date.now() < faultState.swap502UntilMs) {
      telemetry.status5xx += 1;
      res.writeHead(502, { "content-type": "text/html; charset=utf-8", "x-qa-fault": "502_swap" });
      res.end("<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>502 Bad Gateway</body></html>");
      return;
    }

    const pin = String(req.headers["x-mozart-pin-instance"] || "").toUpperCase();
    const idx = pin === "A" ? 0 : pin === "B" ? 1 : rrCounter++ % targets.length;
    if (idx === 0) telemetry.routedA += 1;
    else telemetry.routedB += 1;

    const target = new URL(targets[idx]);
    const upstreamReq = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        method: req.method,
        path: urlStr,
        headers: { ...req.headers, host: `${target.hostname}:${target.port}` },
      },
      (upstreamRes) => {
        const sc = upstreamRes.statusCode || 500;
        if (sc === 404) telemetry.status404 += 1;
        if (sc === 401) telemetry.status401 += 1;
        if (sc >= 500) telemetry.status5xx += 1;

        res.writeHead(sc, {
          ...upstreamRes.headers,
          "x-mozart-served-by": idx === 0 ? "A" : "B",
        });

        if (isSse && res.socket) {
          activeSseSockets.add(res.socket);
          res.once("close", () => activeSseSockets.delete(res.socket));
        }

        let frames = 0;
        upstreamRes.on("data", (chunk) => {
          frames += 1;
          res.write(chunk);
          if (
            isSse &&
            faultState.killSseAtChunkCount > 0 &&
            faultState.killedCount === 0 &&
            frames >= faultState.killSseAtChunkCount
          ) {
            faultState.killedCount += 1;
            faultState.killSseAtChunkCount = 0;
            upstreamRes.destroy();
            res.socket?.destroy();
          }
        });
        upstreamRes.on("end", () => res.end());
        upstreamRes.on("error", () => res.destroy());
      },
    );

    upstreamReq.on("error", () => {
      telemetry.status5xx += 1;
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "application/json" });
      }
      res.end(JSON.stringify({ error: "BAD_GATEWAY" }));
    });

    req.pipe(upstreamReq);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      resolve({
        url: `http://${host}:${addr.port}`,
        port: addr.port,
        telemetry,
        close: () => {
          server.closeAllConnections?.();
          return new Promise((r) => server.close(() => r()));
        },
      });
    });
  });
}
