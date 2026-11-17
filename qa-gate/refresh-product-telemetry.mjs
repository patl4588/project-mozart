#!/usr/bin/env node
/**
 * Privacy-Safe Automated Product Telemetry Refresher for Operation Mozart.
 * Mines aggregate usage intelligence from local RailCall Desktop telemetry
 * (`run_ledger.jsonl`, `artifact_trace.jsonl`, `conversations/*.json`) with
 * ZERO PII / user prompt text / file paths emitted.
 *
 * Non-destructive merge: if `telemetry/product_telemetry_summary.json` already
 * contains curated forensic sections (e.g. from Squad Alpha), all curated keys
 * are preserved while `refreshed_at` and `live_rollup` counters are updated.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASH_DIR = path.resolve(__dirname, "..");
const DEFAULT_OUT = path.join(DASH_DIR, "telemetry", "product_telemetry_summary.json");
const APP_SUPPORT = path.join(os.homedir(), "Library", "Application Support", "RailCall Chat");

function percentile(sortedNums, p) {
  if (!sortedNums.length) return 0;
  const idx = Math.min(sortedNums.length - 1, Math.max(0, Math.ceil((p / 100) * sortedNums.length) - 1));
  return sortedNums[idx];
}

function round(n, digits = 2) {
  const f = 10 ** digits;
  return Math.round((Number(n) || 0) * f) / f;
}

export function refreshProductTelemetry({
  appDataDir = APP_SUPPORT,
  outPath = DEFAULT_OUT,
} = {}) {
  const ledgerPath = path.join(appDataDir, "run_ledger.jsonl");
  const artifactPath = path.join(appDataDir, "artifact_trace.jsonl");
  const convDir = path.join(appDataDir, "conversations");

  const ledgerRows = [];
  if (fs.existsSync(ledgerPath)) {
    const lines = fs.readFileSync(ledgerPath, "utf8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        ledgerRows.push(JSON.parse(line));
      } catch {
        // ignore malformed line
      }
    }
  }

  let succeeded = 0;
  let failed = 0;
  let interrupted = 0;
  let guardLedgerHits = 0;
  let localRuns = 0;
  let cloudRuns = 0;
  let byokRuns = 0;
  let totalBilledUsd = 0;
  let totalFrontierUsd = 0;
  let totalTokens = 0;
  const latencies = [];
  const billedCosts = [];
  const byProvider = {};
  const byType = {};
  const byModel = {};

  for (const r of ledgerRows) {
    const st = String(r.status || "").toLowerCase();
    const prov = String(r.provider || "unspecified");
    const errStr = String(r.error || "").toLowerCase();
    const model = String(r.model || (Array.isArray(r.models) && r.models[0]) || "unspecified");
    const runType = String(r.type || "chat");

    byProvider[prov] = (byProvider[prov] || 0) + 1;
    byType[runType] = (byType[runType] || 0) + 1;
    byModel[model] = (byModel[model] || 0) + 1;

    if (prov === "guard" || errStr.includes("chat guard declined")) {
      guardLedgerHits += 1;
    }

    if (st === "interrupted" || st === "cancelled" || st === "canceled") {
      interrupted += 1;
    } else if (st === "failed" || Boolean(r.error) || prov === "guard") {
      failed += 1;
    } else {
      succeeded += 1;
    }

    const isLocal =
      prov.includes("local") ||
      prov.includes("ollama") ||
      model.includes("local") ||
      model.includes("ollama") ||
      model.includes("railcall-") ||
      model.includes(":latest");
    if (isLocal) localRuns += 1;
    else if (prov === "byok") byokRuns += 1;
    else cloudRuns += 1;

    const ms = Number(r.wall_elapsed_ms || 0);
    if (ms > 0) latencies.push(ms);

    const billed = Number(r.billed_usd || 0);
    const frontier = Number(r.frontier_baseline_usd || 0);
    totalBilledUsd += billed;
    totalFrontierUsd += frontier;
    totalTokens += Number(r.run_tokens || 0);
    if (billed >= 0) billedCosts.push(billed);
  }

  latencies.sort((a, b) => a - b);
  billedCosts.sort((a, b) => a - b);

  // Conversations aggregate scan (strictly counts & failure signatures — zero prompt/user text stored)
  let conversationsCount = 0;
  let totalMessages = 0;
  let userMessages = 0;
  let assistantMessages = 0;
  let guardDeclinedMessages = 0;
  let executionUnknownMessages = 0;
  let workflowConversations = 0;

  if (fs.existsSync(convDir)) {
    const files = fs.readdirSync(convDir).filter((f) => f.endsWith(".json"));
    conversationsCount = files.length;
    for (const file of files) {
      try {
        const doc = JSON.parse(fs.readFileSync(path.join(convDir, file), "utf8"));
        if (doc && doc.workflow) workflowConversations += 1;
        const msgs = Array.isArray(doc?.messages) ? doc.messages : [];
        totalMessages += msgs.length;
        for (const m of msgs) {
          const role = String(m?.role || "");
          if (role === "user") userMessages += 1;
          else assistantMessages += 1;
          const txt = String(m?.text || m?.content || "").toLowerCase();
          if (txt.includes("station's chat guard declined")) guardDeclinedMessages += 1;
          if (txt.includes("execution_unknown")) executionUnknownMessages += 1;
        }
      } catch {
        // skip unreadable file
      }
    }
  }

  // Artifact trace aggregate scan
  let artifactEvents = 0;
  const uniqueArtifacts = new Set();
  const artifactsByKind = {};
  if (fs.existsSync(artifactPath)) {
    const lines = fs.readFileSync(artifactPath, "utf8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        artifactEvents += 1;
        if (ev.artifactId) uniqueArtifacts.add(String(ev.artifactId));
        const kind = String(ev.kind || "unknown");
        artifactsByKind[kind] = (artifactsByKind[kind] || 0) + 1;
      } catch {
        // skip
      }
    }
  }

  const totalRuns = ledgerRows.length;
  const successRatePct = totalRuns > 0 ? round((succeeded / totalRuns) * 100, 1) : 0;
  const savingsVsFrontierPct =
    totalFrontierUsd > 0 ? round(((totalFrontierUsd - totalBilledUsd) / totalFrontierUsd) * 100, 1) : 0;

  const topModels = Object.entries(byModel)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([model, runs]) => ({ model, runs }));

  const liveRollup = {
    refreshed_at: new Date().toISOString(),
    privacy_policy: "strict_zero_pii_aggregates_only",
    conversations: {
      total_conversations: conversationsCount,
      total_messages: totalMessages,
      user_messages: userMessages,
      assistant_messages: assistantMessages,
      workflow_conversations: workflowConversations,
      avg_messages_per_conversation: conversationsCount > 0 ? round(totalMessages / conversationsCount, 1) : 0,
    },
    run_ledger: {
      total_runs: totalRuns,
      succeeded,
      failed,
      interrupted,
      success_rate_pct: successRatePct,
      by_type: byType,
      by_provider: byProvider,
      top_models: topModels,
    },
    latency_ms: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      sub_2s_runs: latencies.filter((x) => x <= 2000).length,
      over_20s_runs: latencies.filter((x) => x >= 20000).length,
    },
    economics: {
      total_billed_usd: round(totalBilledUsd, 2),
      total_frontier_baseline_usd: round(totalFrontierUsd, 2),
      savings_vs_frontier_pct: savingsVsFrontierPct,
      p50_billed_usd: round(percentile(billedCosts, 50), 4),
      p95_billed_usd: round(percentile(billedCosts, 95), 4),
      total_tokens: totalTokens,
      local_runs: localRuns,
      byok_runs: byokRuns,
      cloud_runs: cloudRuns,
    },
    pain_point_counters: {
      station_chat_guard_declined_messages: guardDeclinedMessages,
      station_chat_guard_ledger_runs: guardLedgerHits,
      execution_unknown_messages: executionUnknownMessages,
    },
    artifacts: {
      trace_events: artifactEvents,
      unique_artifacts: uniqueArtifacts.size,
      by_kind: artifactsByKind,
    },
  };

  let existing = {};
  if (fs.existsSync(outPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(outPath, "utf8")) || {};
    } catch {
      existing = {};
    }
  }

  const prevLr = existing.live_rollup || {};
  const mergedLiveRollup = {
    ...prevLr,
    ...liveRollup,
    conversations: { ...(prevLr.conversations || {}), ...liveRollup.conversations },
    run_ledger: { ...(prevLr.run_ledger || {}), ...liveRollup.run_ledger },
    latency_ms: { ...(prevLr.latency_ms || {}), ...liveRollup.latency_ms },
    economics: { ...(prevLr.economics || {}), ...liveRollup.economics },
    pain_point_counters: { ...(prevLr.pain_point_counters || {}), ...liveRollup.pain_point_counters },
    artifacts: { ...(prevLr.artifacts || {}), ...liveRollup.artifacts },
  };

  const merged = {
    schema: existing.schema || "mozart.product_telemetry_summary.v1",
    generated_at: existing.generated_at || liveRollup.refreshed_at,
    refreshed_at: liveRollup.refreshed_at,
    ...existing,
    live_rollup: mergedLiveRollup,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
  return merged;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const idx = process.argv.indexOf("--out");
  const outPath = idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : DEFAULT_OUT;
  const doc = refreshProductTelemetry({ outPath });
  const lr = doc.live_rollup;
  console.log(
    `[product-telemetry] Refreshed ${outPath} (${lr.conversations.total_conversations} convs, ${lr.run_ledger.total_runs} runs, success=${lr.run_ledger.success_rate_pct}%, p50=${lr.latency_ms.p50}ms)`,
  );
}
