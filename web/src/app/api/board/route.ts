import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { mergeBoards, replaceBoard, validateBoardPayload, type BoardState } from "@/lib/kanban/merge";

const BOARD_FILE = path.resolve(process.cwd(), "..", "data", "board.json");

async function ensureDir() {
  await fs.mkdir(path.dirname(BOARD_FILE), { recursive: true });
}

// write temp + rename so concurrent CLI writes never observe a torn file
async function atomicWrite(state: BoardState) {
  await ensureDir();
  const tmp = `${BOARD_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ ...state, updatedAt: Date.now() }, null, 2), "utf-8");
  await fs.rename(tmp, BOARD_FILE);
}

export async function GET() {
  try {
    const raw = await fs.readFile(BOARD_FILE, "utf-8");
    const json = JSON.parse(raw);
    return NextResponse.json(json, {
      headers: { "cache-control": "no-store" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("ENOENT")) {
      return NextResponse.json({ tasks: null, activities: [], deletions: [] }, { headers: { "cache-control": "no-store" } });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Full-state sync with lost-update protection (TASK-02).
 * Body is validated, then MERGED into the on-disk board per-task by
 * `updatedAt` — a writer that hydrated before another agent's changes can no
 * longer wipe them. `mode:"replace"` (board import) swaps the task set.
 * Responds with the merged board so clients can reconcile.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const v = validateBoardPayload(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  try {
    let server: BoardState | null = null;
    try {
      server = JSON.parse(await fs.readFile(BOARD_FILE, "utf-8")) as BoardState;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("ENOENT")) console.error("[api/board] read failed, merging onto empty:", msg);
    }
    const merged = isObjWithMode(body) && body.mode === "replace" ? replaceBoard(v.value) : mergeBoards(server, v.value);
    await atomicWrite(merged);
    return NextResponse.json({ ok: true, ...merged });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function isObjWithMode(v: unknown): v is { mode?: string } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
