#!/usr/bin/env node
// NIFTY//PIPELINE — board-first dev workflow for agents
// ADD → CLAIM → WORK → REVIEW → VERIFY → SHIP
//
// usage: node scripts/workflow.mjs <cmd> [opts]
//   start  TASK-ID --agent cipher              claim + move to IN PROGRESS (WIP-aware)
//   verify [--skip-test]                       run gates only (tsc → lint → test)
//   review TASK-ID [--agent cipher]            gates green ⇒ task moves to REVIEW
//   ship   TASK-ID --msg "feat(scope): ..."    requires REVIEW · re-runs gates
//          (--files p1,p2 | --all) [--push] [--force] [--skip-test] [--agent X]
//
// Gates run from web/: npx tsc --noEmit · npm run lint · npm test.
// Ship commits at repo root. data/board.json is flipped to DONE AFTER the commit
// so the status flip lands in the next task's commit, never a mixed one.
// Push is opt-in via --push and never forced.

import fs from "fs";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { CALLSIGNS, load, save, addActivity, findTask, arg, has } from "./board.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const WEB = path.join(ROOT, "web");
const WIP_LIMIT_DOING = 6;
const AGENT_DEFAULT = process.env.USER ?? "SYSTEM";

const GATES = [
  { key: "tsc",  label: "tsc --noEmit", cwd: WEB, cmd: "npx", args: ["tsc", "--noEmit"] },
  { key: "lint", label: "eslint",       cwd: WEB, cmd: "npm", args: ["run", "lint"] },
  { key: "test", label: "node:test",    cwd: WEB, cmd: "npm", args: ["test"] },
];

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function requireAgent() {
  const agent = arg("--agent") ?? AGENT_DEFAULT;
  if (!CALLSIGNS.includes(agent)) die(`Unknown agent "${agent}". Pick a callsign: ${CALLSIGNS.join(", ")}`);
  return agent;
}

function getTask(id) {
  const b = load();
  const t = findTask(b, id);
  if (!t) die(`No task ${id} on board (${b.tasks?.length ?? 0} tasks). Try: node scripts/board.mjs list`);
  return { b, t };
}

// Apply a status flip to a board object. Exported for the race-regression test.
export function flipStatus(b, id, status, actText, agent) {
  const t = findTask(b, id);
  if (!t) return { ok: false, reason: `No task ${id} on board — deleted or renamed mid-run?` };
  t.status = status;
  t.updatedAt = Date.now();
  addActivity(b, id, actText, agent);
  return { ok: true };
}

function git(args, opts = {}) {
  return spawnSync("git", args, { cwd: ROOT, encoding: "utf-8", ...opts });
}

function skipList() { return has("--skip-test") ? ["test"] : []; }

function runGates() {
  const skip = skipList();
  const active = GATES.filter(g => !skip.includes(g.key));
  console.log(`\n▸ GATES · ${active.map(g=>g.label).join(" · ")}`);
  const results = [];
  for (const g of GATES) {
    if (skip.includes(g.key)) { results.push({ ...g, ok:true, ms:0, skipped:true }); continue; }
    console.log(`\n▸ ${g.label}`);
    const t0 = Date.now();
    const r = spawnSync(g.cmd, g.args, { cwd: g.cwd, stdio: "inherit" });
    const ms = Date.now() - t0;
    const ok = !r.error && r.status === 0;
    results.push({ ...g, ok, ms, skipped:false });
    if (!ok) console.log(`✗ ${g.label} failed (${(ms/1000).toFixed(1)}s)`);
    if (!ok) break; // short-circuit — fix the first red gate before the rest
  }
  return results;
}

function printGateSummary(results) {
  console.log("\n▸ GATE SUMMARY");
  for (const r of results) {
    const mark = r.skipped ? "–" : r.ok ? "✓" : "✗";
    console.log(`  ${mark} ${r.label.padEnd(14)} ${r.skipped ? "skipped" : `${(r.ms/1000).toFixed(1)}s`}`);
  }
}

function gatesGreen(results) { return results.every(r=>r.ok); }

// ── start ───────────────────────────────────────────────────────────────
function cmdStart() {
  const id = process.argv[3];
  if (!id) die("Usage: node scripts/workflow.mjs start TASK-ID --agent cipher");
  const agent = requireAgent();
  const { b, t } = getTask(id);
  if (t.status === "done") die(`${id} is DONE — reopen it on /board first.`);
  const wip = b.tasks.filter(x => x.status === "doing").length;
  const wasDoing = t.status === "doing";
  const prev = t.assignee;
  t.assignee = agent;
  t.status = "doing";
  t.updatedAt = Date.now();
  addActivity(b, id, wasDoing ? `re-started by ${agent.toUpperCase()}` : `claimed by ${agent.toUpperCase()} · → doing`, agent);
  save(b);
  console.log(`▸ CLAIMED ${id} · ${agent.toUpperCase()}${prev && prev !== agent ? ` (was ${String(prev).toUpperCase()})` : ""}`);
  if (!wasDoing && wip >= WIP_LIMIT_DOING) console.log(`⚠ WIP ${wip}/${WIP_LIMIT_DOING} — IN PROGRESS at limit, finish something first.`);
  console.log(`\n  work it · tick ACs:  node scripts/board.mjs tick ${id} <n>
  done? gate it:       node scripts/workflow.mjs review ${id} --agent ${agent}`);
}

// ── verify ──────────────────────────────────────────────────────────────
function cmdVerify() {
  const results = runGates();
  printGateSummary(results);
  if (!gatesGreen(results)) die("Red gates.");
  console.log("\n✓ ALL GATES GREEN");
}

// ── review ──────────────────────────────────────────────────────────────
function cmdReview() {
  const id = process.argv[3];
  if (!id) die("Usage: node scripts/workflow.mjs review TASK-ID --agent cipher");
  const agent = requireAgent();
  const { b, t } = getTask(id);
  if (t.blocked) die(`${id} is BLOCKED — unblock before review.`);
  const results = runGates();
  printGateSummary(results);
  if (!gatesGreen(results)) {
    console.log(`\n✗ ${id} stays in ${t.status.toUpperCase()} — fix red gates, re-run review.`);
    process.exit(1);
  }
  const from = t.status;
  // AC2 (TASK-21): never mutate the pre-gate snapshot — reload fresh so the
  // flip lands on the current file instead of resurrecting a stale board.
  b.tasks = load().tasks; // refresh in place: same object, current rows
  const r = flipStatus(b, id, "review", `review · gates green (${results.filter(r=>!r.skipped).map(r=>r.label).join("·")})`, agent);
  if (!r.ok) die(r.reason);
  save(b);
  console.log(`\n✓ ${id}: ${from.toUpperCase()} → REVIEW (${agent.toUpperCase()})
  reviewer ACK then:
  node scripts/workflow.mjs ship ${id} --msg "<type>(scope): what" --files p1,p2 --push`);
}

// ── ship ────────────────────────────────────────────────────────────────
function cmdShip() {
  const id = process.argv[3];
  const msg = arg("--msg") ?? arg("--message");
  if (!id || !msg) die('Usage: node scripts/workflow.mjs ship TASK-ID --msg "feat(board): ..." (--files p1,p2 | --all) [--push]');
  const agent = requireAgent();
  const { b, t } = getTask(id);
  if (t.blocked) die(`${id} is BLOCKED.`);
  if (t.status !== "review" && !has("--force")) die(`${id} is ${t.status.toUpperCase()}, not REVIEW. Run review first (or --force).`);

  console.log(`\n▸ SHIP ${id}`);
  const results = runGates();
  printGateSummary(results);
  if (!gatesGreen(results)) die("Red gates — ship aborted.");

  const files = (arg("--files") ?? "").split(",").map(s=>s.trim()).filter(Boolean);
  const all = has("--all");
  if (!files.length && !all) die("Stage scope required: --files src/a.ts,docs/b.md (scoped) or --all (bulk).");
  if (files.length) {
    for (const f of files) if (!fs.existsSync(path.resolve(ROOT, f))) die(`--files entry not found: ${f}`);
    const s = git(["add", "--", ...files]);
    if (s.status !== 0) die(`git add failed:\n${s.stderr}`);
  } else {
    console.log("⚠ --all staged every change in the tree — mind other agents' WIP.");
    const s = git(["add", "-A"]);
    if (s.status !== 0) die(`git add -A failed:\n${s.stderr}`);
  }
  if (git(["diff", "--cached", "--quiet"]).status === 0) die("Nothing staged — no changes to commit.");

  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
  const full = msg.includes(id) ? msg : `[${id}] ${msg}`;
  const c = git(["commit", "-m", full], { stdio: "inherit" });
  if (c.status !== 0) die("git commit failed.");
  const hash = git(["rev-parse", "--short", "HEAD"]).stdout.trim();

  let pushed = false;
  if (has("--push")) {
    console.log(`\n▸ PUSH origin/${branch}`);
    const p = git(["push", "origin", "HEAD"], { stdio: "inherit" });
    if (p.status !== 0) {
      console.log(`✗ push failed — commit ${hash} is local on ${branch}. Task stays in REVIEW.
  retry manually: git push origin ${branch}, then flip ${id} to done on /board.`);
      process.exit(1);
    }
    pushed = true;
  }

  // board AFTER commit — the status flip rides the next commit, never this one.
  // TASK-21: reload fresh (gates + commit held the pre-run board for 40s+).
  b.tasks = load().tasks; // refresh in place: same object, current rows
  const flip = flipStatus(b, id, "done", `shipped ${hash}${pushed ? ` → origin/${branch}` : " (local)"} · ${full}`, agent);
  if (!flip.ok) {
    console.log(`⚠ board not flipped: ${flip.reason} — set ${id} to done on /board manually.`);
  } else {
    save(b);
  }

  console.log(`\n✓ SHIPPED ${id} · ${hash} · ${branch}${pushed ? " · pushed" : ""}\n  ${full}`);
  if (!pushed) console.log("  not pushed — run: git push origin HEAD");
}

function help() {
  console.log(`
NIFTY//PIPELINE — board-first dev workflow

  ADD     node scripts/board.mjs new --title "..." --check "ac one;ac two"
  CLAIM   node scripts/workflow.mjs start TASK-ID --agent cipher
  WORK    edit code · node scripts/board.mjs tick TASK-ID <n>
  REVIEW  node scripts/workflow.mjs review TASK-ID --agent cipher
  VERIFY  reviewer re-runs gates (+ Playwright sanity when UI changed)
  SHIP    node scripts/workflow.mjs ship TASK-ID --msg "feat(scope): ..." --files p1,p2 --push

cmds:
  start  TASK-ID --agent cipher            claim + IN PROGRESS (warns past WIP 6)
  verify [--skip-test]                     gates only: tsc → lint → test
  review TASK-ID [--agent X]               gates green ⇒ REVIEW
  ship   TASK-ID --msg "..." [opts]        gates ⇒ stage ⇒ commit ⇒ [--push] ⇒ DONE

ship opts:
  --files a,b,c    scoped staging (multi-agent safe)
  --all            stage everything (bulk)
  --push           push origin HEAD after commit (never forced)
  --force          skip REVIEW-status precondition
  --skip-test      skip node:test gate (tsc+lint always run)

Examples:
  node scripts/workflow.mjs start TASK-32 --agent cipher
  node scripts/workflow.mjs review TASK-32 --agent cipher
  node scripts/workflow.mjs ship TASK-32 --msg "feat(board): pipeline CLI" --files scripts/workflow.mjs,docs/BOARD.md --push
`);
}

const cmd = process.argv[2];
const isMain = Boolean(process.argv[1]) && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;

if (!isMain) {
  // imported as module — no CLI
} else if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") help();
else if (cmd === "start") cmdStart();
else if (cmd === "verify") cmdVerify();
else if (cmd === "review") cmdReview();
else if (cmd === "ship") cmdShip();
else { console.error(`Unknown cmd ${cmd}`); help(); process.exit(1); }
