import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  fileRedRun,
  noteGreenRun,
  findOpenCiCard,
  greenStreak,
} from "../ci-board-sync.mjs";

const RED = { suite: "ui-smoke", runUrl: "https://ci/run/1", sha: "abc1234def" };

test("red run files a P1 card; second red updates instead of duplicating", () => {
  const b = { tasks: [], activities: [] };

  const first = fileRedRun({ b, ...RED });
  assert.equal(first.created, true);
  const card = findOpenCiCard(b, "ui-smoke");
  assert.ok(card, "open card exists");
  assert.equal(card.id, first.id);
  assert.equal(card.priority, "P1");
  assert.equal(card.status, "todo");
  assert.ok(card.title.startsWith("CI RED: ui-smoke @ abc1234"));
  assert.equal(card.assignee, null);

  const second = fileRedRun({ b, ...RED, sha: "bbb2222" });
  assert.equal(second.created, false);
  assert.equal(second.id, first.id, "same card updated");

  const openCards = (b.tasks ?? []).filter((t) => t.status !== "done");
  assert.equal(openCards.length, 1, "no duplicate cards for same suite");
});

test("three consecutive greens auto-close; red in between resets streak", () => {
  const b = { tasks: [], activities: [] };
  const { id } = fileRedRun({ b, ...RED });

  assert.deepEqual(noteGreenRun({ b, suite: "ui-smoke", runUrl: "r2" }), { closed: false, streak: 1 });
  fileRedRun({ b, ...RED }); // still-red note breaks the trail
  assert.equal(greenStreak(b, id), 0, "red note resets streak");
  noteGreenRun({ b, suite: "ui-smoke", runUrl: "r3" });
  assert.deepEqual(noteGreenRun({ b, suite: "ui-smoke", runUrl: "r4" }).streak, 2);
  const last = noteGreenRun({ b, suite: "ui-smoke", runUrl: "r5" });
  assert.deepEqual(last, { closed: true, streak: 3 });
  assert.equal(findOpenCiCard(b, "ui-smoke"), undefined, "card no longer open");
});

test("green with no open card is a no-op and does not save", () => {
  const b = { tasks: [], activities: [] };
  assert.deepEqual(noteGreenRun({ b, suite: "ci", runUrl: "r1" }), { closed: false, streak: 0 });
});

test("CLI end-to-end persists through merge-on-save board writer", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "niftyterm-ciboard-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "board.json");
  writeFileSync(file, JSON.stringify({ tasks: [], activities: [] }));

  // child process: board.mjs resolves NIFTY_BOARD_FILE at module load, so the
  // env override must exist before the module does (TASK-21 sandbox pattern).
  // Absolute script path — npm test runs from web/, so a repo-root-relative
  // path would MODULE_NOT_FOUND under the shared gate (CIPHER, TASK-1370 ship window).
  const run = (...args) =>
    execFileSync(
      "node",
      [path.join(import.meta.dirname, "..", "ci-board-sync.mjs"), ...args],
      {
        env: { ...process.env, NIFTY_BOARD_FILE: file },
      }
    );

  run("--status", "red", "--suite", "ci", "--run-url", "u1", "--sha", "aaa1111");
  let saved = JSON.parse(readFileSync(file, "utf-8"));
  assert.equal(saved.tasks.length, 1);

  for (let i = 2; i <= 4; i++) {
    run("--status", "green", "--suite", "ci", "--run-url", `u${i}`, "--sha", "aaa1111");
  }
  saved = JSON.parse(readFileSync(file, "utf-8"));
  assert.equal(saved.tasks[0].status, "done", "auto-closed on disk");
});
