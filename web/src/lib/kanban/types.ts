export type ColumnId = "backlog" | "todo" | "doing" | "review" | "done";
export type Priority = "P0" | "P1" | "P2" | "P3";
export type PhaseId = "A" | "B" | "C" | "D" | "E";

export interface Agent {
  id: string;
  callsign: string;
  color: string;
  glyph: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  desc: string;
  phase: PhaseId;
  priority: Priority;
  status: ColumnId;
  assignee: string | null;
  labels: string[];
  estimate: number;
  checklist: ChecklistItem[];
  createdAt: number;
  updatedAt: number;
  rank?: number | null;
  edge?: number | null;
  blocked?: boolean;
}

export interface Column {
  id: ColumnId;
  label: string;
  wip?: number;
  hint: string;
}

export const COLUMNS: Column[] = [
  { id: "backlog", label: "BACKLOG", hint: "icebox · not ready" },
  { id: "todo", label: "TODO", hint: "ready to pick" },
  { id: "doing", label: "IN PROGRESS", wip: 6, hint: "WIP · max 6" },
  { id: "review", label: "REVIEW", wip: 4, hint: "PR · tsc/lint/e2e" },
  { id: "done", label: "DONE", hint: "shipped" },
];

export const PHASE_META: Record<PhaseId, { label: string; color: string; desc: string }> = {
  A: { label: "STABILIZE", color: "#0e7a3a", desc: "1–7 · harden data & UX" },
  B: { label: "PLATFORM", color: "#2563eb", desc: "8–13 · DB & ingest" },
  C: { label: "ENGINE", color: "#7c3aed", desc: "14–20 · strategy alpha" },
  D: { label: "TERMINAL", color: "#c2410c", desc: "21–26 · screener & breadth" },
  E: { label: "LAUNCH", color: "#0891b2", desc: "27–30 · ship & grow" },
};

export const PRIORITY_META: Record<Priority, { label: string; dot: string; bg: string }> = {
  P0: { label: "CRITICAL", dot: "#dc2626", bg: "bg-down-soft text-down border-down/20" },
  P1: { label: "HIGH", dot: "#ea580c", bg: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50" },
  P2: { label: "MED", dot: "#2563eb", bg: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/50" },
  P3: { label: "LOW", dot: "#9aa0a8", bg: "bg-panel-2 text-muted border-line" },
};
