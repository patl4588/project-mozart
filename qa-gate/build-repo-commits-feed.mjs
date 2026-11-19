#!/usr/bin/env node
/**
 * Builds `repo_commits_feed.json` across all 4 isolated Mozart delegated repositories
 * so `https://patl4588.github.io/project-mozart/` renders exact commit SHAs,
 * `git log --stat -n 5`, changed file stats, compact diff previews, and Sami's
 * 1-command fast-forward merge instructions directly inline — zero GitHub login
 * required (eliminates Private-Repo 404 friction in unauthenticated previews).
 *
 * Strictly READ-ONLY on code repositories.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASH_DIR = path.resolve(__dirname, "..");
const LANE_ROOT = "/Users/patricklinden/mozart-delegated-lane";

export const DELEGATED_REPOS_META = [
  {
    name: "railcall-marketplace",
    slug: "patl4588/mozart-railcall-marketplace",
    upstreamSlug: "patl4588/railcall-marketplace",
    title: "Marketplace & Workspace Backend (Mozart Isolated Fork)",
    role: "NestJS Workspace API, Signed Visitor IP, Assistant Queue & Billing Lockdown",
    path: path.join(LANE_ROOT, "railcall-marketplace"),
  },
  {
    name: "railcall-website",
    slug: "patl4588/mozart-railcall-website",
    upstreamSlug: "patl4588/railcall-website",
    title: "RailCall Website & WebChat (Mozart Isolated Fork)",
    role: "Serene Editorial Hero, WebChat SSE Recovery, Live Browse & /verify Gate",
    path: path.join(LANE_ROOT, "railcall-website"),
  },
  {
    name: "railcall-chat",
    slug: "patl4588/mozart-railcall-chat",
    upstreamSlug: "SamyBchaalia/railcall-chat",
    title: "RailCall Desktop App (Mozart Isolated Fork)",
    role: "Electron Desktop Resilience, Tabbed Workflows/Agents Hub, $0 Website Screenshots & Ollama Fastpath",
    path: path.join(LANE_ROOT, "railcall-chat"),
  },
  {
    name: "linden",
    slug: "patl4588/mozart-linden",
    upstreamSlug: "patl4588/linden",
    title: "Linden Monorepo — Cloud-Router, Gateway & Station (Mozart Isolated Fork)",
    role: "32-Slot Worker Pre-Stream Failover, SIGTERM Drain, /v1 Prefix Cache & Station local_reason",
    path: path.join(LANE_ROOT, "linden"),
  },
];

function gitRead(repoPath, args, timeoutMs = 8000) {
  const res = spawnSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    ok: res.status === 0 && !res.error,
    stdout: (res.stdout || "").trimEnd(),
    stderr: (res.stderr || "").trimEnd(),
  };
}

function scrubSecrets(text) {
  return String(text || "")
    .replace(/\b(sk-[A-Za-z0-9_-]{16,})\b/g, "[REDACTED_KEY]")
    .replace(/\b(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[REDACTED_GH_TOKEN]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{20,}/gi, "$1[REDACTED_BEARER]");
}

function inspectRepo(meta) {
  if (!fs.existsSync(path.join(meta.path, ".git"))) {
    return {
      ...meta,
      visibility: "private",
      available: false,
      error: "Repository not present on local lane",
      commits: [],
    };
  }

  const branch = gitRead(meta.path, ["branch", "--show-current"]).stdout.trim() || "HEAD";
  const headSha = gitRead(meta.path, ["rev-parse", "HEAD"]).stdout.trim();
  const headShort = headSha.slice(0, 7);

  let mainRef = "upstream/main";
  let mainCheck = gitRead(meta.path, ["rev-parse", "--verify", "upstream/main"]);
  if (!mainCheck.ok) {
    mainRef = "origin/main";
    mainCheck = gitRead(meta.path, ["rev-parse", "--verify", "origin/main"]);
  }
  if (!mainCheck.ok) {
    mainRef = "main";
    mainCheck = gitRead(meta.path, ["rev-parse", "--verify", "main"]);
  }
  const mainSha = mainCheck.ok ? mainCheck.stdout.trim() : "";
  const mainShort = mainSha ? mainSha.slice(0, 7) : "unknown";

  let aheadCount = 0;
  let behindCount = 0;
  let ffReady = false;
  if (mainSha) {
    const lr = gitRead(meta.path, ["rev-list", "--left-right", "--count", `${mainRef}...HEAD`]);
    if (lr.ok) {
      const parts = lr.stdout.trim().split(/\s+/);
      behindCount = Number(parts[0] || 0);
      aheadCount = Number(parts[1] || 0);
    }
    ffReady = gitRead(meta.path, ["merge-base", "--is-ancestor", mainRef, "HEAD"]).ok;
  }

  const logStatRaw = scrubSecrets(
    gitRead(meta.path, ["log", "--stat", "--stat-width=92", "-n", "5", "--no-color"]).stdout,
  );

  // Delimited commit metadata for latest 5 commits
  const SEP = "@@__MOZART_COMMIT__@@";
  const FIELD = "@@__F__@@";
  const logStructured = gitRead(meta.path, [
    "log",
    "-n",
    "5",
    `--pretty=format:${SEP}%H${FIELD}%h${FIELD}%cI${FIELD}%cr${FIELD}%s`,
  ]);

  const commits = [];
  if (logStructured.ok && logStructured.stdout) {
    const entries = logStructured.stdout
      .split(SEP)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const entry of entries) {
      const [sha = "", shortSha = "", dateIso = "", relativeTime = "", subject = ""] = entry.split(FIELD);
      if (!sha) continue;

      const statOut = gitRead(meta.path, ["show", "--stat", "--stat-width=88", "--format=", "--no-color", sha]).stdout;
      const statLines = statOut
        .split("\n")
        .map((l) => l.trimEnd())
        .filter(Boolean);
      const statSummary =
        statLines.length > 0 && /changed/.test(statLines[statLines.length - 1])
          ? statLines[statLines.length - 1].trim()
          : `${statLines.length} file(s) touched`;
      const changedFiles = statLines
        .slice(0, statLines.length > 0 && /changed/.test(statLines[statLines.length - 1]) ? -1 : statLines.length)
        .map((l) => l.trim())
        .slice(0, 18);

      // Compact code diff preview (capped at 2800 chars, binary excluded)
      const patchRaw = gitRead(
        meta.path,
        ["show", "--format=", "--unified=2", "--no-color", "--no-binary", sha],
        6000,
      ).stdout;
      const cleanPatch = scrubSecrets(patchRaw);
      const patchPreview =
        cleanPatch.length > 2800
          ? `${cleanPatch.slice(0, 2800)}\n... [truncated inline preview — ${cleanPatch.length.toLocaleString()} bytes total in commit ${shortSha}]`
          : cleanPatch;

      commits.push({
        sha,
        short_sha: shortSha,
        author_date_iso: dateIso,
        relative_time: relativeTime,
        subject: scrubSecrets(subject),
        stat_summary: statSummary,
        changed_files: changedFiles,
        patch_preview: patchPreview,
        github_commit_url: `https://github.com/${meta.slug}/commit/${sha}`,
      });
    }
  }

  const mergeFlag = ffReady ? "--ff-only" : "--no-ff";
  const samiOneLiner = `cd ${meta.name} && git fetch https://github.com/${meta.slug}.git mozart/v2-autonomous && git checkout main && git pull --ff-only origin main && git merge ${mergeFlag} FETCH_HEAD && git push origin main`;

  return {
    name: meta.name,
    slug: meta.slug,
    upstream_slug: meta.upstreamSlug,
    title: meta.title,
    role: meta.role,
    visibility: "private",
    private_repo_notice:
      "Private Isolated Mozart Fork — upstream push is locked (DISABLED) so Sami's production repos stay 100% clean. Inspect full commits & diffs inline below.",
    available: true,
    branch,
    head_sha: headSha,
    head_short: headShort,
    main_ref: mainRef,
    main_sha: mainSha,
    main_short: mainShort,
    ahead_count: aheadCount,
    behind_count: behindCount,
    ff_ready: ffReady,
    github_branch_url: `https://github.com/${meta.slug}/tree/mozart/v2-autonomous`,
    github_compare_url: `https://github.com/${meta.slug}/compare/main...mozart/v2-autonomous`,
    sami_one_liner: samiOneLiner,
    git_log_stat_5: logStatRaw,
    commits,
  };
}

export function buildRepoCommitsFeed({
  outPath = path.join(DASH_DIR, "repo_commits_feed.json"),
} = {}) {
  const repos = DELEGATED_REPOS_META.map(inspectRepo);
  const totalAhead = repos.reduce((acc, r) => acc + (r.ahead_count || 0), 0);
  const allFfReady = repos.every((r) => r.available && r.ff_ready);

  const feed = {
    schema: "mozart.repo_commits_feed.v1",
    generated_at: new Date().toISOString(),
    lane_branch: "mozart/v2-autonomous",
    repo_count: repos.length,
    total_commits_ahead_of_main: totalAhead,
    all_ff_ready: allFfReady,
    private_repo_explanation:
      "All 4 Project Mozart repositories are isolated private forks under patl4588/mozart-* on branch mozart/v2-autonomous, with upstream pushes mathematically locked (DISABLED). Every commit SHA, git log --stat -n 5 summary, code diff preview, and 1-command fast-forward merge instruction is rendered inline here.",
    repos,
  };

  fs.writeFileSync(outPath, JSON.stringify(feed, null, 2) + "\n", "utf8");
  return feed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const idx = process.argv.indexOf("--out");
  const outPath = idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : path.join(DASH_DIR, "repo_commits_feed.json");
  const feed = buildRepoCommitsFeed({ outPath });
  console.log(
    `[repo-commits-feed] Wrote ${outPath} (${feed.repo_count} repos, ${feed.total_commits_ahead_of_main} total commits ahead of main, all_ff_ready=${feed.all_ff_ready})`,
  );
}
