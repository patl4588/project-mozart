#!/usr/bin/env node
/**
 * Deterministic $0.00 Streaming SSE/JSON Mock LLM Upstream for Mozart QA Gatekeeper.
 * Supports fault-injection directives via prompt tags or headers:
 *   [QA_STREAM_CHUNKS=12,CHUNK_MS=250]
 *   [QA_STALL_TTFT_MS=20000]
 *   [QA_FAIL_STATUS=429] / [QA_FAIL_STATUS=402]
 */
import http from "node:http";

export function startMockLlmUpstream({ port = 0, host = "127.0.0.1" } = {}) {
  const stats = { requests: 0, streamedChunks: 0, injectedFailures: 0, byModel: {} };

  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, stats }));
      return;
    }
    if (req.method === "POST" && req.url === "/__reset") {
      stats.requests = 0;
      stats.streamedChunks = 0;
      stats.injectedFailures = 0;
      stats.byModel = {};
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body = {};
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      body = {};
    }

    stats.requests += 1;
    const model = String(body.model || "mock-fast-floor");
    stats.byModel[model] = (stats.byModel[model] || 0) + 1;

    const allText = JSON.stringify(body.messages || body.prompt || "");
    const failMatch = allText.match(/\[QA_FAIL_STATUS=(\d{3})\]/);
    if (failMatch || req.headers["x-qa-fail-status"]) {
      const code = Number(failMatch?.[1] || req.headers["x-qa-fail-status"] || 503);
      stats.injectedFailures += 1;
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `Injected QA upstream failure ${code}`, type: "qa_fault" } }));
      return;
    }

    const ttftMatch = allText.match(/\[QA_STALL_TTFT_MS=(\d+)\]/);
    const ttftMs = Number(ttftMatch?.[1] || req.headers["x-qa-stall-ttft-ms"] || 25);
    if (ttftMs > 0) {
      await new Promise((r) => setTimeout(r, ttftMs));
      if (req.destroyed) return;
    }

    const streamCfg = allText.match(/\[QA_STREAM_CHUNKS=(\d+),CHUNK_MS=(\d+)\]/);
    const numChunks = Number(streamCfg?.[1] || 8);
    const chunkMs = Number(streamCfg?.[2] || 35);

    const rememberMatch = allText.match(/ORION-\d+/);
    const baseAnswer = rememberMatch
      ? `Verified memory recall (${rememberMatch[0]}). Deterministic Mozart QA response.`
      : `Deterministic Mozart QA verified response from ${model}.`;

    if (body.stream) {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      const words = baseAnswer.split(/(\s+)/).filter(Boolean);
      const total = Math.max(numChunks, words.length);
      for (let i = 0; i < total; i++) {
        if (req.destroyed || res.writableEnded) return;
        const piece = words[i] ?? ` [${i + 1}]`;
        const frame = {
          id: `chatcmpl_qa_${stats.requests}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
        };
        res.write(`data: ${JSON.stringify(frame)}\n\n`);
        stats.streamedChunks += 1;
        if (chunkMs > 0) await new Promise((r) => setTimeout(r, chunkMs));
      }
      const finalFrame = {
        id: `chatcmpl_qa_${stats.requests}`,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 120, completion_tokens: total * 2, total_tokens: 120 + total * 2 },
      };
      res.write(`data: ${JSON.stringify(finalFrame)}\n\ndata: [DONE]\n\n`);
      res.end();
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: `chatcmpl_qa_${stats.requests}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, message: { role: "assistant", content: baseAnswer }, finish_reason: "stop" }],
        usage: { prompt_tokens: 120, completion_tokens: 32, total_tokens: 152 },
      }),
    );
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      resolve({
        url: `http://${host}:${addr.port}`,
        port: addr.port,
        stats,
        close: () => {
          server.closeAllConnections?.();
          return new Promise((r) => server.close(() => r()));
        },
      });
    });
  });
}
