#!/usr/bin/env node
// NIFTY//BOARD CLI — headless Kanban for agents
// usage: node scripts/board.mjs <cmd> [opts]
// cmds: list, agents, claim, assign, move, block, new, tick, log, help
// Helpers are exported for scripts/workflow.mjs (pipeline CLI). The CLI
// dispatch at the bottom only runs when this file is the entrypoint.

import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { mergeBoards } from "../web/src/lib/kanban/board-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// NIFTY_BOARD_FILE: override for tests / parallel sandboxes (TASK-21)
const BOARD_FILE = process.env.NIFTY_BOARD_FILE
  ? path.resolve(process.env.NIFTY_BOARD_FILE)
  : path.resolve(__dirname, "..", "data", "board.json");

export const CALLSIGNS = ["ghost","viper","phantom","nova","axiom","blade","cipher","orion","vector","spectre","neon","raven","falcon","wraith","kite","hawk","sable","echo","frost","jet","lynx","mantis","vertex","quark"];

export function load() {
  if (!fs.existsSync(BOARD_FILE)) {
    console.error(`No board file at ${BOARD_FILE}. Start the dev server once (UI creates it) or add tasks via: node scripts/board.mjs new --title "..."`);
    process.exit(1);
  }
  const j = JSON.parse(fs.readFileSync(BOARD_FILE, "utf-8"));
  return j;
}
export function save(data) {
  // merge-on-save (TASK-21): writers hold `data` for up to 40s+ across gate
  // runs; writing it verbatim clobbers everything that landed in between
  // (the TASK-15/14 incident). Re-read the file and LWW-merge per task id,
  // honoring deletion tombstones, immediately before the atomic write.
  let current = null;
  try {
    current = JSON.parse(fs.readFileSync(BOARD_FILE, "utf-8"));
  } catch {
    // missing/corrupt file → merge onto empty (same semantics as POST /api/board)
  }
  const merged = mergeBoards(current, data);
  merged.updatedAt = Date.now();
  fs.mkdirSync(path.dirname(BOARD_FILE), { recursive: true });
  // temp+rename: readers (GET /api/board, other CLIs) never see a torn file
  const tmp = `${BOARD_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2));
  fs.renameSync(tmp, BOARD_FILE);
}

export function uid() { return Math.random().toString(36).slice(2,6).toUpperCase(); }

// TASK-27: derive the next numeric id from the MAX existing suffix, not
// tasks.length — length-based ids duplicate once anything is deleted, and
// simultaneous creators both minted the same id (LWW then ate one; the merge
// now mangles instead, but distinct ids at creation are still better).
export function nextTaskId(b) {
  let max = 0;
  for (const t of b.tasks ?? []) {
    const m = /^TASK-(\d+)$/.exec(t.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `TASK-${String(max + 1).padStart(2, "0")}`;
}
export function arg(name, def=null) {
  const i = process.argv.indexOf(name);
  if (i === -1) return def;
  const v = process.argv[i+1];
  if (!v || v.startsWith("--")) return def;
  return v;
}
export function has(name) { return process.argv.includes(name); }
export function findTask(b, id) { return (b.tasks ?? []).find(t=>t.id===id); }

export function addActivity(b, taskId, text, agent) {
  b.activities = b.activities ?? [];
  b.activities.unshift({ id: uid(), taskId, text, agent: String(agent).toUpperCase(), at: Date.now() });
  b.activities = b.activities.slice(0,80);
}

function help() {
  console.log(`
NIFTY//BOARD CLI

  list [--status backlog|todo|doing|review|done] [--phase A|B|C|D|E] [--priority P0|P1|P2|P3] [--assignee ghost] [--q momentum]
  agents [--free]
  claim TASK-ID --agent ghost
  assign TASK-ID --agent sable
  move TASK-ID doing|todo|review|done|backlog [--agent ghost]
  block TASK-ID [--on|--off] [--agent ghost]
  new --title "..." [--phase D] [--priority P2] [--status todo] [--agent raven] [--labels ui,api] [--estimate 3] [--check "ac one;ac two"]
  tick TASK-ID <itemId|#ord> [--off] [--agent ghost]
  log [--limit 20]
  help

Examples:
  node scripts/board.mjs list --status doing
  node scripts/board.mjs claim TASK-15 --agent ghost
  node scripts/board.mjs move TASK-15 review --agent ghost
  node scripts/board.mjs tick TASK-15 2
  node scripts/board.mjs new --title "Wire board to Sentry" --phase E --priority P1 --status todo --agent raven
`);
}

function cmdList() {
  const b = load();
  let tasks = b.tasks ?? [];
  const status = arg("--status");
  const phase = arg("--phase");
  const prio = arg("--priority");
  const assignee = arg("--assignee");
  const q = arg("--q") ?? arg("--query");
  if (status) tasks = tasks.filter(t=>t.status===status);
  if (phase) tasks = tasks.filter(t=>t.phase===phase);
  if (prio) tasks = tasks.filter(t=>t.priority===prio);
  if (assignee) tasks = tasks.filter(t=>t.assignee===assignee);
  if (q) {
    const l = q.toLowerCase();
    tasks = tasks.filter(t=> `${t.id} ${t.title} ${t.desc} ${t.labels.join(" ")}`.toLowerCase().includes(l));
  }
  console.log(`\n${tasks.length} tasks${status?` · status=${status}`:""}${phase?` · phase=${phase}`:""}${prio?` · prio=${prio}`:""}${assignee?` · assignee=${assignee}`:""}${q?` · q=${q}`:""}\n`);
  const pad = (s,n)=> String(s).padEnd(n);
  console.log(pad("ID",10)+pad("PH",4)+pad("PR",4)+pad("STATUS",11)+pad("ASSIGNEE",11)+pad("EST",4)+"TITLE");
  console.log("-".repeat(90));
  for (const t of tasks) {
    console.log(pad(t.id,10)+pad(t.phase,4)+pad(t.priority,4)+pad(t.status,11)+pad(t.assignee??"—",11)+pad(t.estimate,4)+t.title+(t.blocked?" [BLOCKED]":""));
  }
  console.log("");
}
function cmdAgents() {
  const b = load();
  const counts = {};
  for (const t of (b.tasks ?? [])) if (t.assignee) counts[t.assignee]=(counts[t.assignee]??0)+1;
  let list = CALLSIGNS.map(id=> ({ id, count: counts[id]??0 }));
  if (has("--free")) list = list.sort((a,b)=>a.count-b.count);
  console.log("\nCALLSIGNS  (pick one, stay consistent)\n");
  for (const a of list) {
    console.log(`  ${a.id.padEnd(10)} ${String(a.count).padStart(2)} tasks  ${a.id.toUpperCase()}`);
  }
  console.log("\nSet via: node scripts/board.mjs claim TASK-15 --agent ghost\n");
}
function cmdClaimOrAssign(isClaim) {
  const id = process.argv[3];
  const agent = arg("--agent");
  if (!id || !agent) { console.error(`Usage: node scripts/board.mjs ${isClaim?"claim":"assign"} TASK-ID --agent ghost`); process.exit(1); }
  if (!CALLSIGNS.includes(agent)) { console.error(`Unknown agent ${agent}. Pick from: ${CALLSIGNS.join(", ")}`); process.exit(1); }
  const b = load();
  const t = b.tasks.find(x=>x.id===id);
  if (!t) { console.error(`No task ${id}`); process.exit(1); }
  t.assignee = agent;
  t.updatedAt = Date.now();
  addActivity(b, id, `${isClaim?"claimed by":"assigned to"} ${agent.toUpperCase()}`, agent);
  save(b);
  console.log(`${isClaim?"Claimed":"Assigned"} ${id} → ${agent.toUpperCase()}`);
}
function cmdMove() {
  const id = process.argv[3];
  const to = process.argv[4];
  const agent = arg("--agent") ?? process.env.USER ?? "SYSTEM";
  const allowed = ["backlog","todo","doing","review","done"];
  if (!id || !to || !allowed.includes(to)) { console.error(`Usage: node scripts/board.mjs move TASK-ID ${allowed.join("|")} [--agent ghost]`); process.exit(1); }
  const b = load();
  const t = b.tasks.find(x=>x.id===id);
  if (!t) { console.error(`No task ${id}`); process.exit(1); }
  const from = t.status;
  t.status = to;
  t.updatedAt = Date.now();
  addActivity(b, id, `moved ${from} → ${to}`, agent);
  save(b);
  console.log(`Moved ${id}: ${from} → ${to} (${agent.toUpperCase()})`);
}
function cmdBlock() {
  const id = process.argv[3];
  const on = has("--on") ? true : has("--off") ? false : null;
  const agent = arg("--agent") ?? process.env.USER ?? "SYSTEM";
  if (!id || on===null) { console.error("Usage: node scripts/board.mjs block TASK-ID --on|--off [--agent ghost]"); process.exit(1); }
  const b = load();
  const t = b.tasks.find(x=>x.id===id);
  if (!t) { console.error(`No task ${id}`); process.exit(1); }
  t.blocked = on;
  t.updatedAt = Date.now();
  addActivity(b, id, on?"blocked":"unblocked", agent);
  save(b);
  console.log(`${on?"Blocked":"Unblocked"} ${id}`);
}
function cmdNew() {
  const title = arg("--title");
  if (!title) { console.error('Usage: node scripts/board.mjs new --title "..." [--phase D] [--priority P2] [--status todo] [--agent raven]'); process.exit(1); }
  const b = load();
  const nid = nextTaskId(b);
  const phase = arg("--phase") ?? "D";
  const priority = arg("--priority") ?? "P2";
  const status = arg("--status") ?? "todo";
  const agent = arg("--agent") ?? null;
  const labels = (arg("--labels")??"").split(",").map(s=>s.trim()).filter(Boolean);
  const estimate = Number(arg("--estimate")??3);
  const checklist = (arg("--check")??"").split(";").map(s=>s.trim()).filter(Boolean)
    .map((text,i)=>({ id:String(i+1), text, done:false }));
  const t = {
    id: nid,
    title,
    desc: arg("--desc") ?? "",
    phase, priority, status, assignee: agent, labels, estimate,
    checklist,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    blocked: false,
  };
  b.tasks.push(t);
  b.activities = b.activities ?? [];
  b.activities.unshift({ id: uid(), taskId: nid, text: `created in ${status}`, agent: (agent??"SYSTEM").toUpperCase(), at: Date.now() });
  save(b);

  // TASK-27: if a simultaneous creator minted the same id, the canonical merge
  // preserved ours under a "-2" style suffix instead of LWW-eating it. Report
  // the FINAL id (matched by our unique createdAt), never silently lose it.
  const saved = (load().tasks ?? []).find((x) => x.id === nid && x.createdAt === t.createdAt)
    ?? (load().tasks ?? []).find((x) => x.createdAt === t.createdAt && x.title === t.title);
  console.log(`Created ${saved ? saved.id : nid} → ${status} · ${title}`);
}
function cmdTick() {
  const id = process.argv[3];
  const ref = process.argv[4];
  const off = has("--off");
  const agent = arg("--agent") ?? process.env.USER ?? "SYSTEM";
  if (!id || !ref) { console.error("Usage: node scripts/board.mjs tick TASK-ID <itemId|#ord> [--off] [--agent ghost]"); process.exit(1); }
  const b = load();
  const t = findTask(b, id);
  if (!t) { console.error(`No task ${id}`); process.exit(1); }
  const item = t.checklist.find(c=>c.id===ref) ?? t.checklist[Number(ref)-1];
  if (!item || Number.isNaN(Number(ref))) { console.error(`No checklist item ${ref} on ${id}`); process.exit(1); }
  item.done = !off;
  t.updatedAt = Date.now();
  addActivity(b, id, `${off?"unchecked":"✓ checked"} ${item.text.slice(0,48)}`, agent);
  save(b);
  const done = t.checklist.filter(c=>c.done).length;
  console.log(`${off?"Unchecked":"Checked"} ${id}#${item.id} · ${done}/${t.checklist.length} ACs done`);
}

function cmdLog() {
  const b = load();
  const lim = Number(arg("--limit")??20);
  const acts = (b.activities ?? []).slice(0,lim);
  if (!acts.length) { console.log("No activity yet."); return; }
  for (const a of acts) {
    const d = new Date(a.at).toLocaleString("en-IN",{ timeZone:"Asia/Kolkata" });
    console.log(`${d}  ${a.taskId.padEnd(10)} ${a.text.padEnd(30)} [${a.agent}]`);
  }
}

const cmd = process.argv[2];
const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (!isMain) {
  // imported as a module (scripts/workflow.mjs) — do not run CLI
} else if (!cmd || cmd==="help" || cmd==="--help" || cmd==="-h") help();
else if (cmd==="list") cmdList();
else if (cmd==="agents") cmdAgents();
else if (cmd==="claim") cmdClaimOrAssign(true);
else if (cmd==="assign") cmdClaimOrAssign(false);
else if (cmd==="move") cmdMove();
else if (cmd==="block") cmdBlock();
else if (cmd==="new") cmdNew();
else if (cmd==="tick") cmdTick();
else if (cmd==="log") cmdLog();
else { console.error(`Unknown cmd ${cmd}`); help(); process.exit(1); }
