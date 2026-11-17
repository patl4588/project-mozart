#!/usr/bin/env node
/**
 * Programmable 2-Instance Non-Sticky Round-Robin + 502/TCP-Reset Chaos Proxy
 * for Operation Mozart QA Gatekeeper.
 *
 * Guarantees bounded upstream header/socket timeouts, clean body draining during
 * 502 fault windows, and deterministic socket teardown on close().
 */
import http from "node:http";
import { fileURLToPath } from "node:url";

export function startSplitBrainChaosProxy({
  targets = [],
  port = 0,
  host = "127.0.0.1",
  upstreamTimeoutMs = 8000,
} = {}) {
  if (!Array.isArray(targets) || targets.length < 2) {
    throw new Error("startSplitBrainChaosProxy requires at least 2 upstream targets [A, B]");
  }

  let rrCounter = 0;
  const activeSseSockets = new Set();
  const allClientSockets = new Set();
  const inFlightUpstreams = new Set();

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
    upstreamTimeouts: 0,
    conversationsCreated: 0,
    messagePosts: 0,
    sseConnectCursors: [],
    meRequests: 0,
  };

  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === "/__qa_control" && req.method === "POST") {
        const buf = [];
        for await (const c of req) buf.push(c);
        let cmd = {};
        try {
          cmd = JSON.parse(Buffer.concat(buf).toString("utf8") || "{}");
        } catch {
          res.writeHead(400, { "content-type": "application/json", connection: "close" });
          res.end(JSON.stringify({ ok: false, error: "INVALID_CONTROL_JSON" }));
          return;
        }
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
            upstreamTimeouts: 0,
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

      // Active 502 container-swap window fault injection (renders real HTML 502 like Cloudflare/Render).
      // Drain incoming body + send connection: close so keep-alive sockets never retain unread bytes.
      if (Date.now() < faultState.swap502UntilMs) {
        telemetry.status5xx += 1;
        req.resume();
        res.writeHead(502, {
          "content-type": "text/html; charset=utf-8",
          "x-qa-fault": "502_swap",
          connection: "close",
        });
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
            if (!res.writableEnded && !res.destroyed) {
              res.write(chunk);
            }
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
          upstreamRes.on("end", () => {
            if (!res.writableEnded && !res.destroyed) res.end();
          });
          upstreamRes.on("error", () => {
            res.destroy();
          });
        },
      );

      inFlightUpstreams.add(upstreamReq);
      upstreamReq.once("close", () => inFlightUpstreams.delete(upstreamReq));

      // Hard header/idle timeout so hung upstreams never stall fetch() into 300s UND_ERR_HEADERS_TIMEOUT
      upstreamReq.setTimeout(upstreamTimeoutMs, () => {
        telemetry.upstreamTimeouts += 1;
        const timeoutErr = new Error(`Upstream failed to respond within ${upstreamTimeoutMs}ms`);
        timeoutErr.code = "UPSTREAM_TIMEOUT";
        upstreamReq.destroy(timeoutErr);
      });

      res.on("close", () => {
        if (!res.writableEnded) {
          upstreamReq.destroy();
        }
      });

      upstreamReq.on("error", (err) => {
        telemetry.status5xx += 1;
        const isTimeout = err?.code === "UPSTREAM_TIMEOUT";
        if (!res.headersSent && !res.destroyed) {
          res.writeHead(isTimeout ? 504 : 502, {
            "content-type": "application/json",
            connection: "close",
          });
          res.end(
            JSON.stringify({
              error: isTimeout ? "GATEWAY_TIMEOUT" : "BAD_GATEWAY",
              detail: String(err?.message || err),
            }),
          );
        } else if (!res.writableEnded && !res.destroyed) {
          res.destroy();
        }
      });

      req.on("error", () => upstreamReq.destroy());
      req.pipe(upstreamReq);
    } catch (err) {
      telemetry.status5xx += 1;
      if (!res.headersSent && !res.destroyed) {
        res.writeHead(500, { "content-type": "application/json", connection: "close" });
      }
      if (!res.writableEnded && !res.destroyed) {
        res.end(JSON.stringify({ error: "CHAOS_PROXY_INTERNAL_ERROR", detail: String(err?.message || err) }));
      }
    }
  });

  server.keepAliveTimeout = 1000;
  server.headersTimeout = Math.max(6000, upstreamTimeoutMs + 2000);
  server.requestTimeout = Math.max(15000, upstreamTimeoutMs + 5000);
  server.on("connection", (sock) => {
    allClientSockets.add(sock);
    sock.once("close", () => allClientSockets.delete(sock));
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
          for (const up of inFlightUpstreams) up.destroy();
          inFlightUpstreams.clear();
          for (const sock of activeSseSockets) sock.destroy();
          activeSseSockets.clear();
          server.closeAllConnections?.();
          for (const sock of allClientSockets) sock.destroy();
          allClientSockets.clear();
          return new Promise((r) => {
            const timer = setTimeout(r, 1500);
            timer.unref?.();
            server.close(() => {
              clearTimeout(timer);
              r();
            });
          });
        },
      });
    });
  });
}

// Standalone self-test when executed directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { startMockLlmUpstream } = await import("./mock-llm-upstream.mjs");
  const upA = await startMockLlmUpstream();
  const upB = await startMockLlmUpstream();
  const proxy = await startSplitBrainChaosProxy({
    targets: [upA.url, upB.url],
    upstreamTimeoutMs: 600,
  });

  try {
    // 1. Inject 450ms 502 swap window and verify HTML 502 + bounded recovery with ORION-42 recall
    await fetch(`${proxy.url}/__qa_control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fault: "502_swap", durationMs: 450 }),
      signal: AbortSignal.timeout(2000),
    });

    let saw502 = false;
    let recovered = false;
    for (let i = 0; i < 6; i++) {
      const r = await fetch(`${proxy.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "fast", messages: [{ role: "user", content: "ORION-42" }] }),
        signal: AbortSignal.timeout(2500),
      });
      if (r.status === 502) {
        saw502 = true;
        await r.text();
      } else if (r.status === 200) {
        const j = await r.json();
        if (String(j?.choices?.[0]?.message?.content || "").includes("ORION-42")) {
          recovered = true;
          break;
        }
      }
      await new Promise((r2) => setTimeout(r2, 200));
    }

    // 2. Verify hung upstream headers trip bounded 504 GATEWAY_TIMEOUT instead of 300s UND_ERR_HEADERS_TIMEOUT
    const hungRes = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-qa-hang-headers-ms": "2000",
      },
      body: JSON.stringify({ model: "fast", messages: [{ role: "user", content: "ping" }] }),
      signal: AbortSignal.timeout(2500),
    });
    const hungJson = await hungRes.json();

    if (!saw502 || !recovered || hungRes.status !== 504 || hungJson.error !== "GATEWAY_TIMEOUT") {
      throw new Error(
        `Self-test failed: saw502=${saw502}, recovered=${recovered}, hungStatus=${hungRes.status}`,
      );
    }

    console.log(
      `[split-brain-chaos-proxy] PASS standalone self-test (saw502=${saw502}, recovered=${recovered}, hungHeaderGuard=${hungRes.status}, upstreamTimeouts=${proxy.telemetry.upstreamTimeouts})`,
    );
  } finally {
    await proxy.close();
    await upA.close();
    await upB.close();
  }
}
