#!/usr/bin/env node
// TASK-1479 — CI failures must never be discovered by luck again.
//
// Bridges GitHub Actions runs onto NIFTY//BOARD using the same merge-on-save
// writer as the human/agent CLI (scripts/board.mjs), so a CI-filed card cannot
// clobber concurrent agent writes.
//
//   red   run → file (or update) an open `CI RED: <suite> @ <sha>` P1 card
//   green run → note it; 3 consecutive greens auto-close the card
//
// Usage (also wired into .github/workflows/{ci,ui-smoke}.yml):
//   node scripts/ci-board-sync.mjs --status red   --suite ui-smoke \
//        --run-url https://…/runs/123 --sha abc1234 [--last-green def5678]
//   node scripts/ci-board-sync.mjs --status green --suite ui-smoke \
//        --run-url https://…/runs/124 --sha abc1234

import { load, save, uid, nextTaskId, addActivity } from "./board.mjs";

export const AGENT = "CI-BOT";

export function findOpenCiCard(b, suite) {
  return (b.tasks ?? []).find(
    (t) => t.status !== "done" && !t.status?.startsWith?.("archived") && t.title.startsWith(`CI RED: ${suite} @`)
  );
}

/** Activities for a task, newest first (board-level trail, unshifted). */
export function cardTrail(b, taskId) {
  return (b.activities ?? []).filter((a) => a.taskId === taskId);
}

/** Consecutive trailing green runs since the last red note. */
export function greenStreak(b, taskId) {
  let n = 0;
  for (const a of cardTrail(b, taskId)) {
    if (a.text.startsWith("green run")) n++;
    else break;
  }
  return n;
}

export const AUTO_CLOSE_AFTER = 3;

export function fileRedRun({ b, suite, runUrl, sha, lastGreen }) {
  const short = (sha ?? "unknown").slice(0, 7);
  const existing = findOpenCiCard(b, suite);
  if (existing) {
    addActivity(b, existing.id, `still red @ ${short} · ${runUrl}`, AGENT);
    return { created: false, id: existing.id };
  }
  const id = nextTaskId(b);
  b.tasks.push({
    id,
    title: `CI RED: ${suite} @ ${short}`,
    desc: [
      `Auto-filed from CI (TASK-1479). Suite \`${suite}\` failed.`,
      ``,
      `- Failing run: ${runUrl}`,
      `- Commit: ${short}${lastGreen ? ` · last green: ${lastGreen.slice(0, 7)}` : ""}`,
      ``,
      `Investigate the failing check first; re-run the suite locally before marking fixed.`,
    ].join("\n"),
    phase: "A",
    priority: "P1",
    status: "todo",
    assignee: null,
    labels: ["ci", "ops"],
    estimate: 2,
    checklist: [
      { id: "1", text: "inspect failing run log", done: false },
      { id: "2", text: "reproduce locally + fix", done: false },
      { id: "3", text: "verify 3 consecutive green scheduled runs", done: false },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    blocked: false,
  });
  b.activities = b.activities ?? [];
  b.activities.unshift({
    id: uid(),
    taskId: id,
    text: `created in todo · failed run ${runUrl}`,
    agent: AGENT,
    at: Date.now(),
  });
  return { created: true, id };
}

export function noteGreenRun({ b, suite, runUrl }) {
  const card = findOpenCiCard(b, suite);
  if (!card) return { closed: false, streak: 0 };
  addActivity(b, card.id, `green run · ${runUrl}`, AGENT);
  const streak = greenStreak(b, card.id);
  if (streak >= AUTO_CLOSE_AFTER) {
    card.status = "done";
    card.updatedAt = Date.now();
    addActivity(
      b,
      card.id,
      `auto-closed after ${streak} consecutive green runs`,
      AGENT
    );
    return { closed: true, streak };
  }
  return { closed: false, streak };
}

function normalizeStatus(raw) {
  const v = String(raw ?? "").toLowerCase();
  if (["green", "success", "passed", "pass"].includes(v)) return "green";
  if (["red", "failure", "failed", "fail", "error"].includes(v)) return "red";
  if (["cancelled", "canceled", "skipped"].includes(v)) return v;
  return v;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--status") args.status = normalizeStatus(argv[++i]);
    else if (a === "--suite") args.suite = argv[++i];
    else if (a === "--run-url") args.runUrl = argv[++i];
    else if (a === "--sha") args.sha = argv[++i];
    else if (a === "--last-green") args.lastGreen = argv[++i];
    else throw new Error(`unknown arg: ${a}`);
  }
  if (["cancelled", "canceled", "skipped"].includes(args.status)) {
    // caller handles early-exit; still considered valid
  } else if (!["red", "green"].includes(args.status)) {
    throw new Error("--status red|green required (got: " + args.status + ")");
  }
  if (!args.suite) throw new Error("--suite required");
  return args;
}

export function main(argv = process.argv) {
  const args = parseArgs(argv);
  if (["cancelled", "canceled", "skipped"].includes(args.status)) {
    console.log(`board: suite ${args.suite} ${args.status} — no board update`);
    return 0;
  }
  const b = load();
  let out;
  if (args.status === "red") {
    out = fileRedRun({ b, ...args });
    save(b);
    console.log(
      out.created
        ? `board: filed CI-red card ${out.id} for ${args.suite}`
        : `board: ${args.suite} already tracked on ${out.id} — appended still-red note`
    );
  } else {
    out = noteGreenRun({ b, ...args });
    if (out.streak > 0 || out.closed) save(b);
    console.log(
      out.closed
        ? `board: ${args.suite} auto-closed ${out.id} after ${out.streak} green runs`
        : out.streak > 0
          ? `board: ${args.suite} green streak ${out.streak}/${AUTO_CLOSE_AFTER}`
          : `board: no open CI-red card for ${args.suite} — nothing to do`
    );
  }
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("ci-board-sync.mjs")) {
  process.exitCode = main();
}
