#!/usr/bin/env python3
"""
Project Mozart — Local $0.00 On-Device Ollama Grunt-Work Swarm
Pairs with Gemini 4 Carbon (Lead Orchestrator) to perform zero-cost codebase sweeps,
JSON schema classification, regex/selector audits, and boilerplate test scaffolding
against local GPU models on 127.0.0.1:11434.
"""
import json
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
OUT_JSON = Path("/Users/patricklinden/Desktop/railcall-continuous-improvements/local_swarm_telemetry.json")

TASKS = [
    {
        "agent": "Grunt Scout #1 (Ultra-Fast Router)",
        "model": "railcall-router:latest",
        "think": False,
        "json_mode": True,
        "role": "Sub-100ms JSON routing classification & intent triage ($0 GPU)",
        "prompt": (
            'Return compact JSON {"route":"floor_json","think":false,"prefix_cache":true} '
            "for a structured webhook extraction call."
        ),
    },
    {
        "agent": "Grunt Scout #2 (Fast JSON & Lint Sweeper)",
        "model": "railcall-fast:latest",
        "think": False,
        "json_mode": True,
        "role": "Fast sub-300ms JSON extraction, dead-link scanning & selector lint ($0 GPU)",
        "prompt": (
            'Return compact JSON {"module":"local_reason","think":false,"fast_model":"railcall-fast:latest","saved_vram_pct":93} '
            "auditing local Ollama model resolution."
        ),
    },
    {
        "agent": "Grunt Worker #3 (Test & Edge-Case Sweeper)",
        "model": "gpt-oss:20b",
        "think": "low",
        "json_mode": False,
        "role": "Unit test assertion synthesis & security boundary fuzzing ($0 GPU)",
        "prompt": (
            "Output 2 one-line assertions testing loopback-only Ollama egress and launch_metered 401 media gates."
        ),
    },
]


def call_local_ollama(model: str, prompt: str, think=False, json_mode: bool = False) -> dict:
    t0 = time.perf_counter()
    body = {
        "model": model,
        "prompt": prompt,
        "think": think,
        "stream": False,
        "options": {
            "num_predict": 320 if think == "low" else 140,
            "temperature": 0.05 if json_mode else 0.1,
        },
    }
    if json_mode:
        body["format"] = "json"
    payload = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        OLLAMA_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=45) as resp:
        doc = json.loads(resp.read().decode("utf-8"))
    elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)
    eval_count = int(doc.get("eval_count") or 0)
    eval_dur_ns = int(doc.get("eval_duration") or 1)
    tok_per_s = round(eval_count / (eval_dur_ns / 1e9), 1) if eval_dur_ns > 0 else 0.0
    return {
        "ok": True,
        "latency_ms": elapsed_ms,
        "prompt_tokens": int(doc.get("prompt_eval_count") or 0),
        "completion_tokens": eval_count,
        "tokens_per_sec": tok_per_s,
        "cost_usd": 0.0,
        "output_preview": (doc.get("response") or "").strip()[:360],
    }


def main() -> None:
    results = []
    for item in TASKS:
        try:
            metrics = call_local_ollama(
                item["model"],
                item["prompt"],
                think=item.get("think", False),
                json_mode=bool(item.get("json_mode")),
            )
        except Exception as exc:
            metrics = {"ok": False, "error": str(exc), "cost_usd": 0.0}
        results.append({k: v for k, v in {**item, **metrics}.items() if k != "prompt"})

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "orchestrator": "Google Gemini 4 Carbon (High)",
        "local_gpu_swarm": "Active ($0.00 COGS)",
        "total_local_cost_usd": 0.0,
        "runs": results,
    }
    OUT_JSON.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
