import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { mergeBoards, replaceBoard, validateBoardPayload, type BoardState } from "@/lib/kanban/merge";
import {
  MAX_BODY_BYTES,
  bodyTooLarge,
  postRateLimited,
  replaceAuthorized,
} from "@/lib/boardGuards";
import { clientKeyFrom } from "@/lib/clientKey";

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
 * Guards (TASK-1370): per-key rate limit → body-size cap (413) → shape
 * validation (400) → mode:"replace" token gate (403). Body is validated,
 * then MERGED into the on-disk board per-task by `updatedAt` — a writer
 * that hydrated before another agent's changes can no longer wipe them.
 * `mode:"replace"` (board import) swaps the task set and additionally
 * requires an `x-board-token` header matching BOARD_WRITE_TOKEN.
 * Responds with the merged board so clients can reconcile.
 */
export async function POST(req: Request) {
  const key = clientKeyFrom(req.headers);
  if (postRateLimited(key)) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": "60" } }
    );
  }

  /* fast reject before buffering when the client declared its size */
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (bodyTooLarge(raw)) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const v = validateBoardPayload(body);
  if (!v.ok) {
    /* TASK-1394: oversized boards are a size problem, not a shape problem */
    return NextResponse.json(
      { error: v.error },
      { status: v.error === "too_many_tasks" ? 413 : 400 }
    );
  }

  if (isObjWithMode(body) && body.mode === "replace") {
    const auth = replaceAuthorized(body.mode, req.headers.get("x-board-token"));
    if (!auth.ok) {
      return NextResponse.json(
        {
          error: auth.configured
            ? "invalid_token"
            : "replace_disabled_set_board_write_token",
        },
        { status: 403 }
      );
    }
  }

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
