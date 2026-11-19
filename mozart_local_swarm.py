#!/usr/bin/env python3
"""
Project Mozart — RailCall + Local Qwen/Ollama $0.00 Sub-Agent Swarm & Dispatcher
================================================================================
Acts both as:
1) Live $0.00 Swarm Health & Telemetry Sweep (`python3 mozart_local_swarm.py`)
2) Direct Sub-Agent CLI Dispatcher (`python3 mozart_local_swarm.py --subagent core --prompt "..." [--file path]`)

Hierarchy of Local $0.00 Sub-Agents (Apple Silicon Unified Memory):
  - L1 router   -> railcall-router:latest (qwen3.5:0.8b, 1.0 GB)       : <100ms task triage & repo routing
  - L2 fast     -> railcall-fast:latest   (qwen3.5:4b, 3.4 GB)         : <300ms JSON schema, dead-link & selector lint
  - L3 security -> gpt-oss:20b            (20B reasoning, 13 GB)       : SSRF, HMAC, auth airlock & edge-case fuzzing
  - L4 core     -> railcall-core:latest   (qwen3-coder:30b MoE, 18 GB) : 262K ctx TypeScript/Python module & test builder
  - L5 coder    -> railcall-coder:latest  (qwen3-coder-next 79.7B, 51G): 262K ctx deep multi-file refactor & diff auditor

Transport Priority:
  1. RailCall Local Station OpenAI /v1 (`http://127.0.0.1:8799/v1/chat/completions`) when `RAILCALL_API_KEY` is set
     (emits Ed25519 signed cryptographic station receipts).
  2. Local Ollama GPU Engine (`http://127.0.0.1:11434/api/generate`) at $0.00 COGS.
"""
from __future__ import annotations
import argparse
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

STATION_V1_URL = os.environ.get("RAILCALL_STATION_URL", "http://127.0.0.1:8799/v1/chat/completions")
OLLAMA_URL = os.environ.get("OLLAMA_GENERATE_URL", "http://127.0.0.1:11434/api/generate")
OUT_JSON = Path("/Users/patricklinden/Desktop/railcall-continuous-improvements/local_swarm_telemetry.json")

SUBAGENT_ROSTER = {
    "router": {
        "tier": "L1 · Triage Router",
        "model": "railcall-router:latest",
        "base": "qwen3.5:0.8b (1.0 GB)",
        "think": False,
        "json_mode": True,
        "num_predict": 160,
        "role": "Sub-100ms JSON routing classification & repo slice triage ($0 GPU)",
    },
    "fast": {
        "tier": "L2 · Fast Lint & Schema Scout",
        "model": "railcall-fast:latest",
        "base": "qwen3.5:4b (3.4 GB)",
        "think": False,
        "json_mode": True,
        "num_predict": 220,
        "role": "Sub-300ms JSON contract validation, dead-link & DOM selector sweep ($0 GPU)",
    },
    "security": {
        "tier": "L3 · Adversarial QA & Security Fuzzer",
        "model": "gpt-oss:20b",
        "base": "gpt-oss:20b (13 GB)",
        "think": "low",
        "json_mode": False,
        "num_predict": 360,
        "role": "SSRF, HMAC, auth airlock & edge-case assertion synthesis ($0 GPU)",
    },
    "core": {
        "tier": "L4 · Specialist Feature & Test Engineer",
        "model": "railcall-core:latest",
        "base": "qwen3-coder:30b MoE (18 GB · 262K ctx)",
        "think": False,
        "json_mode": False,
        "num_predict": 640,
        "role": "262K-context TypeScript/NestJS/Next.js/Electron implementation & unit tests ($0 GPU)",
    },
    "coder": {
        "tier": "L5 · Principal 79.7B Codebase Auditor",
        "model": "railcall-coder:latest",
        "base": "qwen3-coder-next:q4_K_M 79.7B MoE (51 GB · 262K ctx)",
        "think": False,
        "json_mode": False,
        "num_predict": 1024,
        "role": "Deep multi-file AST synthesis, surgical patch review & cross-repo audit ($0 GPU)",
    },
}

SWEEP_TASKS = [
    {
        "subagent": "router",
        "agent": "Sub-Agent L1 · RailCall Router (qwen3.5 0.8B)",
        "prompt": (
            'Return compact JSON {"repo":"mozart-railcall-chat","branch":"mozart/v2-autonomous","tier":"L4_core","cost_usd":0} '
            "triaging a desktop workflow-tab UI task."
        ),
    },
    {
        "subagent": "fast",
        "agent": "Sub-Agent L2 · RailCall Fast Scout (qwen3.5 4B)",
        "prompt": (
            'Return compact JSON {"upstream_push":"DISABLED","fork_isolated":true,"branch":"mozart/v2-autonomous"} '
            "verifying isolated Mozart fork governance."
        ),
    },
    {
        "subagent": "core",
        "agent": "Sub-Agent L4 · RailCall Core Coder (qwen3-coder 30.5B MoE)",
        "prompt": (
            "Write a single concise TypeScript assertion verifying that visual website prompts override workflowActive in RailCall Chat."
        ),
    },
    {
        "subagent": "security",
        "agent": "Sub-Agent L3 · Adversarial Security Fuzzer (gpt-oss 20B)",
        "prompt": (
            "Output 2 one-line assertions testing upstream push=DISABLED git lock and loopback-only local station egress."
        ),
    },
]


def invoke_subagent(
    subagent_key: str,
    prompt: str,
    json_override: bool | None = None,
    max_tokens: int | None = None,
    timeout_sec: int = 60,
) -> dict:
    spec = SUBAGENT_ROSTER[subagent_key]
    model = spec["model"]
    use_json = spec["json_mode"] if json_override is None else json_override
    num_predict = max_tokens or spec["num_predict"]
    rc_key = os.environ.get("RAILCALL_API_KEY", "").strip()

    # 1. Try RailCall Local Station /v1 first if key is configured
    if rc_key:
        try:
            t0 = time.perf_counter()
            v1_body = {
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.05 if use_json else 0.1,
                "max_tokens": num_predict,
            }
            if use_json:
                v1_body["response_format"] = {"type": "json_object"}
            req = urllib.request.Request(
                STATION_V1_URL,
                data=json.dumps(v1_body).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {rc_key}",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
                doc = json.loads(resp.read().decode("utf-8"))
            elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)
            msg = ((doc.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
            usage = doc.get("usage") or {}
            comp_toks = int(usage.get("completion_tokens") or 0)
            return {
                "ok": True,
                "via": "railcall-station-v1",
                "subagent": subagent_key,
                "tier": spec["tier"],
                "model": model,
                "latency_ms": elapsed_ms,
                "prompt_tokens": int(usage.get("prompt_tokens") or 0),
                "completion_tokens": comp_toks,
                "tokens_per_sec": round(comp_toks / max(elapsed_ms / 1000.0, 0.001), 1),
                "cost_usd": 0.0,
                "receipt_id": doc.get("receipt_id") or doc.get("id"),
                "output": msg.strip(),
            }
        except Exception:
            pass  # Seamlessly fall back to direct local Ollama engine

    # 2. Direct Local Qwen/Ollama GPU Engine ($0.00 COGS)
    t0 = time.perf_counter()
    body = {
        "model": model,
        "prompt": prompt,
        "think": spec["think"],
        "stream": False,
        "options": {
            "num_predict": num_predict,
            "temperature": 0.05 if use_json else 0.1,
        },
    }
    if use_json:
        body["format"] = "json"
    req = urllib.request.Request(
        OLLAMA_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
        doc = json.loads(resp.read().decode("utf-8"))
    elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)
    eval_count = int(doc.get("eval_count") or 0)
    eval_dur_ns = int(doc.get("eval_duration") or 1)
    tok_per_s = round(eval_count / (eval_dur_ns / 1e9), 1) if eval_dur_ns > 0 else 0.0
    text_out = (doc.get("response") or "").strip()
    return {
        "ok": True,
        "via": "ollama-local-gpu",
        "subagent": subagent_key,
        "tier": spec["tier"],
        "model": model,
        "latency_ms": elapsed_ms,
        "prompt_tokens": int(doc.get("prompt_eval_count") or 0),
        "completion_tokens": eval_count,
        "tokens_per_sec": tok_per_s,
        "cost_usd": 0.0,
        "output": text_out,
    }


def run_telemetry_sweep(include_79b: bool = False) -> None:
    tasks = list(SWEEP_TASKS)
    if include_79b:
        tasks.append(
            {
                "subagent": "coder",
                "agent": "Sub-Agent L5 · RailCall Coder Next (qwen3-coder-next 79.7B MoE)",
                "prompt": "Output one line confirming 262K-context multi-repo AST audit readiness on branch mozart/v2-autonomous.",
            }
        )
    results = []
    for item in tasks:
        key = item["subagent"]
        spec = SUBAGENT_ROSTER[key]
        try:
            res = invoke_subagent(key, item["prompt"], timeout_sec=90 if key == "coder" else 45)
            results.append(
                {
                    "agent": item["agent"],
                    "subagent": key,
                    "tier": spec["tier"],
                    "model": spec["model"],
                    "base": spec["base"],
                    "role": spec["role"],
                    "ok": True,
                    "via": res["via"],
                    "latency_ms": res["latency_ms"],
                    "prompt_tokens": res["prompt_tokens"],
                    "completion_tokens": res["completion_tokens"],
                    "tokens_per_sec": res["tokens_per_sec"],
                    "cost_usd": 0.0,
                    "output_preview": res["output"][:360],
                }
            )
        except Exception as exc:
            results.append(
                {
                    "agent": item["agent"],
                    "subagent": key,
                    "tier": spec["tier"],
                    "model": spec["model"],
                    "role": spec["role"],
                    "ok": False,
                    "error": str(exc),
                    "cost_usd": 0.0,
                }
            )

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "orchestrator": "Antigravity Lead Architect + Project Mozart Control Plane",
        "isolated_branch": "mozart/v2-autonomous",
        "local_gpu_swarm": "Active ($0.00 COGS · RailCall + Qwen3/Ollama 5-Tier Fleet)",
        "available_roster": {k: {"model": v["model"], "base": v["base"], "role": v["role"]} for k, v in SUBAGENT_ROSTER.items()},
        "total_local_cost_usd": 0.0,
        "runs": results,
    }
    OUT_JSON.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description="Project Mozart — RailCall + Qwen/Ollama Sub-Agent Dispatcher")
    parser.add_argument("--subagent", choices=list(SUBAGENT_ROSTER.keys()), help="Invoke a specific local sub-agent directly")
    parser.add_argument("--prompt", type=str, help="Task prompt for direct sub-agent execution")
    parser.add_argument("--file", type=str, help="Optional file path to attach as context for the sub-agent")
    parser.add_argument("--json", action="store_true", help="Force JSON output mode")
    parser.add_argument("--max-tokens", type=int, default=None, help="Override max output tokens")
    parser.add_argument("--include-79b", action="store_true", help="Include 79.7B railcall-coder in telemetry sweep")
    parser.add_argument("--roster", action="store_true", help="Print the 5-tier sub-agent roster and exit")
    args = parser.parse_args()

    if args.roster:
        print(json.dumps(SUBAGENT_ROSTER, indent=2))
        return

    if args.subagent:
        if not args.prompt:
            sys.exit("--prompt is required when --subagent is set")
        full_prompt = args.prompt
        if args.file:
            file_content = Path(args.file).read_text(encoding="utf-8", errors="replace")[:32000]
            full_prompt = f"File `{args.file}`:\n```\n{file_content}\n```\n\nTask:\n{args.prompt}"
        res = invoke_subagent(
            args.subagent,
            full_prompt,
            json_override=True if args.json else None,
            max_tokens=args.max_tokens,
            timeout_sec=180 if args.subagent == "coder" else 90,
        )
        print(json.dumps(res, indent=2))
        return

    run_telemetry_sweep(include_79b=args.include_79b)


if __name__ == "__main__":
    main()
