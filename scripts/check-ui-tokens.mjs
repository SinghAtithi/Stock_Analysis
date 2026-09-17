#!/usr/bin/env node
/* check-ui-tokens.mjs — palette discipline guard (TASK-1518, UNSLOPIFY §2 rule 1:
 * "Tokens or it didn't happen. No hex/rgb in components.").
 *
 * Scans web/src/**\/*.{ts,tsx} for hardcoded color literals (hex, rgb/rgba,
 * hsl/hsla) and fails on anything not explicitly sanctioned:
 *
 *   - Files in ALLOWED_FILES carry a reason each (canvas fallbacks, crash
 *     shells that render without globals.css, OG images, board chrome).
 *   - Lines calling token("--name", "#fallback") are allowed: the fallback is
 *     the current token value verbatim (ChartPanel.tsx / backtest pattern).
 *   - Neutral overlay/alpha washes — rgba/rgb where max−min channel <= 4 and
 *     alpha < 1 — are allowed (chart grid, crosshair, shadows). These are
 *     opacity-based neutrals, not palette colors; chromatic rgba is flagged.
 *
 * Usage:
 *   node scripts/check-ui-tokens.mjs [--root dir] [--json]
 * Exit: 0 clean, 1 violations.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT } from "./lib/db.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

/* Whole-file exceptions, each with the reason it must keep literals. */
export const ALLOWED_FILES = new Map([
  ["web/src/components/ChartPanel.tsx", "canvas/SVG fallbacks behind token() reads (TASK-193)"],
  ["web/src/components/ThemeToggle.tsx", "theme-color meta literal, applied before CSS vars exist"],
  ["web/src/app/layout.tsx", "viewport themeColor meta literals"],
  ["web/src/app/error.tsx", "SSR crash shell ships without globals.css"],
  ["web/src/app/global-error.tsx", "global crash shell ships without globals.css"],
  ["web/src/*/opengraph-image.tsx", "ImageResponse has no CSS var support"],
  ["web/src/lib/kanban/agents.ts", "board-only callsign chrome quarantine (UNSLOPIFY rule 4)"],
  ["web/src/lib/kanban/types.ts", "board-only callsign chrome quarantine"],
  ["web/src/app/board/page.tsx", "board-only callsign chrome quarantine"],
]);

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/;
const FN_RE = /(rgba?|hsla?)\(([^)]*)\)/g;

/* Minimal glob: `*` matches anything including path separators, so a pattern
 * like web/src/STAR/opengraph-image.tsx covers nested routes (app/s/[symbol]/).
 * STAR is written in prose to keep this comment from closing early. */
export function matchesPattern(file, pattern) {
  const f = file.split(path.sep).join("/");
  const rx = new RegExp(
    "^" + pattern.split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$"
  );
  return rx.test(f);
}

export function isNeutralOverlay(fn, args) {
  if (fn === "hsl" || fn === "hsla") return false; /* no sanctioned hsl use */
  const parts = args.split(/[,\s/]+/).filter(Boolean);
  if (parts.length < 4) return false; /* rgb (opaque) is a color, not an overlay */
  const ch = parts.slice(0, 3).map(Number);
  if (ch.some((n) => !Number.isFinite(n))) return false;
  const alphaRaw = parts[3];
  const alpha = alphaRaw.endsWith("%") ? parseFloat(alphaRaw) / 100 : Number(alphaRaw);
  if (!Number.isFinite(alpha) || alpha >= 1) return false;
  return Math.max(...ch) - Math.min(...ch) <= 4;
}

/* Returns [{ line, text, kind }] for one file's source. */
export function findColorLiterals(source, filePath = "") {
  const rel = filePath.split(path.sep).join("/");
  for (const [pattern, reason] of ALLOWED_FILES) {
    if (matchesPattern(rel, pattern)) return [];
  }
  const out = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    if (text.includes("token(")) continue; /* token(name, fallback) — fallback is the token value */
    if (HEX_RE.test(text)) {
      out.push({ line: i + 1, text: text.trim(), kind: "hex" });
      continue;
    }
    FN_RE.lastIndex = 0;
    let m;
    while ((m = FN_RE.exec(text)) !== null) {
      if (!isNeutralOverlay(m[1], m[2])) {
        out.push({ line: i + 1, text: m[0], kind: m[1] });
        break;
      }
    }
  }
  return out;
}

export function scanRoot(root) {
  const findings = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (entry === "node_modules" || entry === ".next") continue;
        walk(full);
      } else if (/\.(tsx|ts)$/.test(entry)) {
        const src = readFileSync(full, "utf8");
        const hits = findColorLiterals(src, path.relative(REPO_ROOT, full));
        if (hits.length) findings.push({ file: path.relative(REPO_ROOT, full), hits });
      }
    }
  };
  walk(root);
  return findings;
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const rootIdx = argv.indexOf("--root");
  const root = rootIdx >= 0 ? argv[rootIdx + 1] : path.join(REPO_ROOT, "web", "src");
  const findings = scanRoot(root);
  const total = findings.reduce((n, f) => n + f.hits.length, 0);
  if (json) {
    console.log(JSON.stringify({ root, total, findings }, null, 2));
  } else if (total === 0) {
    console.log(`ui-tokens: clean — no unsanctioned color literals under ${path.relative(REPO_ROOT, root) || root}`);
  } else {
    console.error(`ui-tokens: ${total} unsanctioned color literal(s) in ${findings.length} file(s) — UNSLOPIFY.md §2 rule 1`);
    for (const f of findings) {
      console.error(`\n  ${f.file}`);
      for (const h of f.hits) console.error(`    ${h.line}: ${h.text}`);
    }
    console.error("\n  Fix: consume a token (var(--color-*) / Tailwind token class) or, if the");
    console.error("  literal is structurally required, add the file to ALLOWED_FILES with a reason.");
  }
  process.exit(total === 0 ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(here, "check-ui-tokens.mjs")) {
  main();
}
