"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Modal from "@/components/Modal";
import ThemeToggle from "@/components/ThemeToggle";
import MarketStatus from "@/components/MarketStatus";
import DataTable from "@/components/DataTable";
import type { Column as DTCol } from "@/components/DataTable";
import { COLUMNS, PHASE_META, PRIORITY_META, type ColumnId, type Task, type Priority, type PhaseId } from "@/lib/kanban/types";
import { CALLSIGNS, AGENT_BY_ID } from "@/lib/kanban/agents";
import type { Tombstone } from "@/lib/kanban/merge";
import {
  Search,
  Plus,
  GripVertical,
  X,
  Check,
  Clock3,
  AlertTriangle,
  Layers,
  Zap,
  Shield,
  Database,
  FileText,
  ArrowRight,
  Trash2,
  Copy,
  Filter,
  Table2,
  LayoutGrid,
  Download,
  Upload,
  HelpCircle,
  ChevronDown,
} from "lucide-react";

type Activity = { id: string; taskId: string; text: string; agent: string; at: number };
type ViewMode = "board" | "list";

const STORAGE_KEY = "nifty.board.v1";
const AGENT_KEY = "nifty.board.agent";

function uid() {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}
function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
function useClock() {
  const [t, setT] = useState<string | null>(null);
  useEffect(() => {
    const f = () =>
      new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date());
    const tick = () => setT(f());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}

function AgentAvatar({ id, size = 28 }: { id: string | null; size?: number }) {
  if (!id || !AGENT_BY_ID[id]) {
    return (
      <span
        className="inline-flex items-center justify-center rounded-full border border-dashed border-line bg-panel-2 text-[10px] font-medium text-faint"
        style={{ width: size, height: size }}
        title="Unassigned"
      >
        —
      </span>
    );
  }
  const a = AGENT_BY_ID[id];
  return (
    <span
      className="inline-flex items-center justify-center rounded-full border-2 font-mono text-[10px] font-bold text-ink shadow-sm dark:text-paper"
      style={{
        width: size,
        height: size,
        borderColor: a.color,
        background: `color-mix(in srgb, ${a.color} 20%, var(--color-surface))`,
      }}
      title={a.callsign}
    >
      {a.callsign.slice(0, 2)}
    </span>
  );
}

function PriorityDot({ p }: { p: Priority }) {
  const m = PRIORITY_META[p];
  return <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: m.dot }} aria-hidden />;
}

export default function BoardPage() {
  const clock = useClock();
  const [tasks, setTasks] = useState<Task[]>([]);
  // false until first /api/board hydration settles; gates the persist effect so
  // pre-hydration state (empty) never races the GET and clobbers the server board
  const hydratedRef = useRef(false);
  const [activities, setActivities] = useState<Activity[]>([]);
  // deletion tombstones — sent with every sync so deletes survive server-side
  // merge (a task absent from a stale writer's payload must NOT be resurrected)
  const [deletions, setDeletions] = useState<Tombstone[]>([]);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [phaseFilter, setPhaseFilter] = useState<PhaseId | "ALL">("ALL");
  const [prioFilter, setPrioFilter] = useState<Priority | "ALL">("ALL");
  const [assigneeFilter, setAssigneeFilter] = useState<string | "ALL">("ALL");
  const [view, setView] = useState<ViewMode>("board");
  const [selected, setSelected] = useState<Task | null>(null);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [newOpen, setNewOpen] = useState<ColumnId | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<ColumnId | null>(null);
  const [showFilters, setShowFilters] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ---- load
  useEffect(() => {
    try {
      const a = localStorage.getItem(AGENT_KEY);
      if (a && AGENT_BY_ID[a]) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate agent
        setAgentId(a);
      } else {
        const rnd = CALLSIGNS[Math.floor(Math.random() * CALLSIGNS.length)].id;
        setAgentId(rnd);
        localStorage.setItem(AGENT_KEY, rnd);
      }
    } catch {}
    // load board
    let local: { tasks?: Task[]; activities?: Activity[]; deletions?: Tombstone[] } | null = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) local = JSON.parse(raw);
    } catch {}
    const loadRemote = async () => {
      try {
        const res = await fetch("/api/board", { cache: "no-store" });
        const json = await res.json();
        if (json.tasks && Array.isArray(json.tasks)) {
          setTasks(json.tasks);
          setActivities(json.activities ?? []);
          setDeletions(json.deletions ?? []);
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ tasks: json.tasks, activities: json.activities ?? [], deletions: json.deletions ?? [] }));
          return;
        }
      } catch {}
      if (local?.tasks?.length) {
        setTasks(local.tasks);
        setActivities(local.activities ?? []);
        setDeletions(local.deletions ?? []);
      }
    };
    loadRemote().finally(() => { hydratedRef.current = true; });
  }, []);

  // persist local + remote (debounced). POSTs merge server-side by task id
  // (TASK-02); `mode:"replace"` after an import so snapshots swap, not merge.
  const saveRef = useRef<number | null>(null);
  const replaceNextRef = useRef(false);
  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ tasks, activities, deletions }));
      localStorage.setItem(AGENT_KEY, agentId ?? "");
    } catch {}
    const replace = replaceNextRef.current;
    replaceNextRef.current = false;
    if (saveRef.current) window.clearTimeout(saveRef.current);
    saveRef.current = window.setTimeout(() => {
      fetch("/api/board", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tasks, activities, deletions, ...(replace ? { mode: "replace" } : {}) }),
      }).catch(() => {});
    }, 600);
    return () => {
      if (saveRef.current) window.clearTimeout(saveRef.current);
    };
  }, [tasks, activities, deletions, agentId]);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      const inInput = tag === "input" || tag === "textarea" || (document.activeElement as HTMLElement)?.isContentEditable;
      if ((e.key === "/" && !inInput) || (e.key === "k" && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (!inInput && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setNewOpen("todo");
      }
      if (e.key === "?" && !inInput) setHelpOpen((v) => !v);
      if (e.key === "Escape") {
        setHelpOpen(false);
        setAgentPickerOpen(false);
        if (selected) setSelected(null);
        else if (newOpen) setNewOpen(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, newOpen]);

  const pushActivity = useCallback(
    (taskId: string, text: string) => {
      const a: Activity = { id: uid(), taskId, text, agent: agentId ? AGENT_BY_ID[agentId]?.callsign ?? agentId : "SYSTEM", at: Date.now() };
      setActivities((prev) => [a, ...prev].slice(0, 80));
    },
    [agentId],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (phaseFilter !== "ALL" && t.phase !== phaseFilter) return false;
      if (prioFilter !== "ALL" && t.priority !== prioFilter) return false;
      if (assigneeFilter !== "ALL" && t.assignee !== assigneeFilter) return false;
      if (!q) return true;
      const hay = `${t.id} ${t.title} ${t.desc} ${t.labels.join(" ")} ${t.phase}`.toLowerCase();
      return hay.includes(q);
    });
  }, [tasks, query, phaseFilter, prioFilter, assigneeFilter]);

  const byColumn = useMemo(() => {
    const m: Record<ColumnId, Task[]> = { backlog: [], todo: [], doing: [], review: [], done: [] };
    for (const t of filtered) m[t.status].push(t);
    // keep board order by updatedAt desc for active, but preserve rank for todo? simple: updatedAt
    for (const k of Object.keys(m) as ColumnId[]) m[k].sort((a, b) => a.updatedAt - b.updatedAt);
    return m;
  }, [filtered]);

  const stats = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === "done").length;
    const doing = tasks.filter((t) => t.status === "doing").length;
    const review = tasks.filter((t) => t.status === "review").length;
    const blocked = tasks.filter((t) => t.blocked).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    return { total, done, doing, review, blocked, pct };
  }, [tasks]);

  const moveTask = (id: string, to: ColumnId) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        if (t.status === to) return t;
        return { ...t, status: to, updatedAt: Date.now() };
      }),
    );
    const from = tasks.find((t) => t.id === id)?.status;
    if (from !== to) pushActivity(id, `moved ${from ?? "?"} → ${to}`);
  };

  const updateTask = (patch: Partial<Task> & { id: string }) => {
    setTasks((prev) => prev.map((t) => (t.id === patch.id ? { ...t, ...patch, updatedAt: Date.now() } : t)));
    if (selected?.id === patch.id) setSelected((s) => (s ? { ...s, ...patch, updatedAt: Date.now() } : s));
  };

  const createTask = (col: ColumnId, data: Partial<Task>) => {
    const id = `TASK-${String(tasks.length + 1).padStart(2, "0")}`;
    // ensure unique if exists
    let finalId = id;
    let n = tasks.length + 1;
    while (tasks.some((t) => t.id === finalId)) {
      n += 1;
      finalId = `TASK-${String(n).padStart(2, "0")}`;
    }
    const t: Task = {
      id: finalId,
      title: (data.title ?? "New task").trim() || "New task",
      desc: data.desc ?? "",
      phase: (data.phase as PhaseId) ?? "D",
      priority: (data.priority as Priority) ?? "P2",
      status: col,
      assignee: data.assignee ?? agentId,
      labels: data.labels ?? [],
      estimate: data.estimate ?? 3,
      checklist: data.checklist ?? [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      blocked: false,
    };
    setTasks((prev) => [...prev, t]);
    pushActivity(finalId, `created in ${col}`);
    setNewOpen(null);
  };

  const deleteTask = (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    // tombstone so server-side merge drops the task instead of resurrecting it
    setDeletions((prev) => [...prev.filter((d) => d.id !== id), { id, at: Date.now() }]);
    setSelected(null);
    pushActivity(id, "deleted");
  };

  const duplicateTask = (id: string) => {
    const src = tasks.find((t) => t.id === id);
    if (!src) return;
    const nid = `TASK-${uid()}`;
    // eslint-disable-next-line react-hooks/purity -- handler, not render
    const now = Date.now();
    const copy: Task = { ...src, id: nid, title: src.title + " (copy)", createdAt: now, updatedAt: now, status: src.status };
    setTasks((prev) => [...prev, copy]);
    pushActivity(nid, `duplicated from ${id}`);
  };

  const agentsWithCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of tasks) if (t.assignee) counts[t.assignee] = (counts[t.assignee] ?? 0) + 1;
    return CALLSIGNS.map((a) => ({ ...a, count: counts[a.id] ?? 0 }));
  }, [tasks]);

  const handleExport = async () => {
    const payload = JSON.stringify({ tasks, activities, exportedAt: new Date().toISOString() }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nifty-board-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const j = JSON.parse(String(r.result));
        if (j.tasks && Array.isArray(j.tasks)) {
          setTasks(j.tasks);
          if (j.activities) setActivities(j.activities);
          setDeletions([]);
          replaceNextRef.current = true; // snapshot replaces the board, not merges
          pushActivity("BOARD", "imported JSON");
          alert(`Imported ${j.tasks.length} tasks`);
        }
      } catch (err) {
        alert("Bad JSON: " + String(err));
      }
    };
    r.readAsText(f);
    e.target.value = "";
  };

  // derived clock title
  const subtitle = useMemo(() => {
    const qActive = query || phaseFilter !== "ALL" || prioFilter !== "ALL" || assigneeFilter !== "ALL";
    return qActive ? `${filtered.length} / ${tasks.length} tasks · filtered` : `${tasks.length} tasks · ${stats.done} done · ${stats.pct}%`;
  }, [query, phaseFilter, prioFilter, assigneeFilter, filtered.length, tasks.length, stats.done, stats.pct]);

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      {/* header */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-surface/85 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-paper text-[11px] font-bold tracking-widest text-ink">N</span>
            <span className="hidden text-sm font-semibold tracking-tight text-paper sm:inline">
              NIFTY <span className="font-normal text-muted">Board</span>
            </span>
            <span className="rounded-full border border-line bg-panel-2 px-2 py-0.5 font-mono text-[10px] font-medium tracking-wide text-muted sm:ml-1">KANBAN</span>
          </Link>
          <nav className="hidden items-center gap-1 text-sm lg:flex">
            <Link href="/" className="rounded-full px-3 py-1.5 text-muted transition-colors hover:bg-panel-2 hover:text-paper">
              Terminal
            </Link>
            <Link href="/screener" className="rounded-full px-3 py-1.5 text-muted transition-colors hover:bg-panel-2 hover:text-paper">
              Screener
            </Link>
            <Link href="/breadth" className="rounded-full px-3 py-1.5 text-muted transition-colors hover:bg-panel-2 hover:text-paper">
              Breadth
            </Link>
            <span aria-current="page" className="rounded-full bg-paper px-3 py-1.5 text-sm font-medium text-ink shadow-sm">
              Board
            </span>
          </nav>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <span className="hidden font-mono text-xs tabular-nums text-faint sm:inline">{clock ? `${clock} IST` : "—"}</span>
          <MarketStatus />
          <ThemeToggle />
          <button
            onClick={() => setHelpOpen(true)}
            aria-label="Help"
            className="hidden h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-muted hover:text-paper sm:inline-flex"
          >
            <HelpCircle size={14} />
          </button>
          <button
            onClick={() => setAgentPickerOpen(true)}
            className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-paper shadow-sm hover:bg-panel-2"
            title="Change callsign"
          >
            <span className="hidden sm:inline">YOU:</span>
            <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 text-[10px] font-bold text-ink dark:text-paper" style={{ borderColor: agentId ? AGENT_BY_ID[agentId]?.color ?? "#111214" : "#111214", background: `color-mix(in srgb, ${agentId ? AGENT_BY_ID[agentId]?.color ?? "#111214" : "#111214"} 20%, var(--color-surface))` }}>
              {agentId ? AGENT_BY_ID[agentId]?.callsign.slice(0, 2) ?? "??" : "??"}
            </span>
            <span className="max-w-[90px] truncate font-mono text-xs font-semibold tracking-wide">{agentId ? AGENT_BY_ID[agentId]?.callsign ?? agentId : "—"}</span>
            <ChevronDown size={12} className="text-faint" />
          </button>
        </div>
      </header>

      {/* subheader stats */}
      <div className="border-b border-line bg-panel-2/40">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="flex flex-wrap items-center gap-2 text-[22px] font-semibold tracking-tight text-paper sm:text-2xl">
                <span className="font-mono text-faint">NIFTY//</span>BOARD
                <span className="rounded-full bg-paper px-2.5 py-0.5 font-mono text-xs font-bold tracking-widest text-ink">MISSION CONTROL</span>
              </h1>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
                Pick a callsign, claim a task, ship. Drag to move. <span className="font-mono text-faint">TASK-01…30</span> from{" "}
                <span className="font-medium text-paper">ROADMAP.md</span> — phases A→E. All agents work here.{" "}
                <Link href="/disclaimer" className="underline decoration-line underline-offset-2 hover:text-paper">
                  Not investment advice
                </Link>
                .
              </p>
              <p className="mt-2 inline-flex flex-wrap items-center gap-2 font-mono text-xs text-muted">
                <span className="rounded-full border border-line bg-surface px-2.5 py-1">{subtitle}</span>
                <span className="hidden items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 sm:inline-flex">
                  <span className={`h-1.5 w-1.5 rounded-full ${stats.blocked ? "bg-down" : "bg-up"}`} /> {stats.blocked} blocked · {stats.doing} doing · {stats.review} review
                </span>
              </p>
            </div>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:min-w-[320px]">
              {/* progress */}
              <div className="rounded-2xl border border-line bg-surface p-3 shadow-sm">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium tracking-wide text-muted">SPRINT PROGRESS</span>
                  <span className="font-mono tabular-nums text-paper">{stats.pct}%</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-panel-2">
                  <div className="h-full rounded-full bg-paper transition-all" style={{ width: `${stats.pct}%` }} />
                </div>
                <div className="mt-2 flex justify-between font-mono text-[11px] tabular-nums text-faint">
                  <span>{stats.done} done</span>
                  <span>{stats.total - stats.done} left</span>
                  <span>{stats.total} total</span>
                </div>
              </div>
              <div className="hidden grid-cols-3 gap-2 sm:grid">
                {[
                  { k: "WIP", v: stats.doing, hint: "in progress", icon: Zap },
                  { k: "REVIEW", v: stats.review, hint: "awaiting gate", icon: Shield },
                  { k: "BLOCKED", v: stats.blocked, hint: "needs help", icon: AlertTriangle },
                ].map(({ k, v, hint, icon: Icon }) => (
                  <div key={k} className="rounded-xl border border-line bg-surface px-3 py-2 text-center shadow-sm">
                    <div className="flex items-center justify-center gap-1 text-[11px] font-medium tracking-wide text-faint">
                      <Icon size={12} /> {k}
                    </div>
                    <div className={`mt-1 font-mono text-xl font-semibold tabular-nums ${k === "BLOCKED" && v > 0 ? "text-down" : "text-paper"}`}>{v}</div>
                    <div className="text-[11px] text-faint">{hint}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* agent dock */}
          <div
            className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin"
            tabIndex={0}
            role="region"
            aria-label="Agent filters — scrollable"
          >
            <span className="shrink-0 rounded-full border border-line bg-surface px-2.5 py-1 font-mono text-[11px] font-medium tracking-wide text-muted">AGENTS</span>
            <div className="flex items-center gap-1.5">
              {agentsWithCounts.slice(0, 16).map((a) => {
                const isYou = a.id === agentId;
                const active = assigneeFilter === a.id;
                return (
                  <button
                    key={a.id}
                    onClick={() => setAssigneeFilter((prev) => (prev === a.id ? "ALL" : a.id))}
                    aria-pressed={active}
                    title={`${a.callsign} · ${a.count} tasks${isYou ? " · YOU" : ""}`}
                    className={`group inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                      active
                        ? "border-paper bg-paper text-ink shadow-sm"
                        : isYou
                          ? "border-paper/40 bg-paper text-ink shadow-sm"
                          : "border-line bg-surface text-muted hover:border-line-strong hover:text-paper"
                    }`}
                  >
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded-full border-2 text-[9px] font-bold text-ink dark:text-paper"
                      style={{
                        borderColor: a.color,
                        background: `color-mix(in srgb, ${a.color} 20%, var(--color-surface, #ffffff))`,
                      }}
                    >
                      {a.callsign.slice(0, 2)}
                    </span>
                    <span className="hidden font-mono tracking-wide sm:inline">{a.callsign}</span>
                    <span className={`rounded-full px-1 py-0.5 font-mono text-[11px] ${active || isYou ? "bg-black/10 text-ink" : "bg-panel-2 text-muted"}`}>{a.count}</span>
                    {isYou && <span className="hidden text-[10px] font-bold tracking-widest sm:inline">YOU</span>}
                  </button>
                );
              })}
              <button onClick={() => setAgentPickerOpen(true)} className="shrink-0 rounded-full border border-dashed border-line bg-surface px-3 py-1 text-xs font-medium text-muted hover:text-paper">
                + {CALLSIGNS.length - 16} more
              </button>
            </div>
            <div className="ml-auto hidden items-center gap-2 sm:flex">
              <span className="hidden font-mono text-xs text-faint lg:inline">Press</span>
              <kbd className="hidden rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-xs text-muted lg:inline">/</kbd>
              <span className="hidden text-xs text-faint lg:inline">to search ·</span>
              <kbd className="hidden rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-xs text-muted lg:inline">N</kbd>
              <span className="hidden text-xs text-faint lg:inline">new task</span>
            </div>
          </div>
        </div>
      </div>

      {/* filters */}
      <div className="sticky top-[57px] z-20 border-b border-line bg-surface/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-4 py-3 sm:px-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-1 items-center gap-2">
              <div className="relative flex-1 sm:max-w-[360px]">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search TASK-15, momentum, phoenix…"
                  className="h-11 sm:h-9 w-full rounded-full border border-line bg-canvas pl-9 pr-3 font-mono text-sm text-paper placeholder:text-faint focus:border-paper focus:outline-none focus:ring-2 focus:ring-paper/10"
                />
                {query && (
                  <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-faint hover:text-paper">
                    <X size={14} />
                  </button>
                )}
              </div>
              <button
                onClick={() => setShowFilters((v) => !v)}
                aria-pressed={showFilters}
                className={`hidden h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium sm:inline-flex ${showFilters ? "border-paper bg-paper text-ink" : "border-line bg-surface text-muted hover:text-paper"}`}
              >
                <Filter size={14} /> Filters
              </button>
              {(query || phaseFilter !== "ALL" || prioFilter !== "ALL" || assigneeFilter !== "ALL") && (
                <button
                  onClick={() => {
                    setQuery("");
                    setPhaseFilter("ALL");
                    setPrioFilter("ALL");
                    setAssigneeFilter("ALL");
                  }}
                  className="hidden h-9 shrink-0 rounded-full border border-line bg-surface px-3 text-sm font-medium text-muted hover:text-paper sm:inline-flex"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-full border border-line bg-panel-2 p-1">
                <button
                  onClick={() => setView("board")}
                  aria-pressed={view === "board"}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${view === "board" ? "bg-surface text-paper shadow-sm" : "text-muted hover:text-paper"}`}
                >
                  <LayoutGrid size={12} /> BOARD
                </button>
                <button
                  onClick={() => setView("list")}
                  aria-pressed={view === "list"}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${view === "list" ? "bg-surface text-paper shadow-sm" : "text-muted hover:text-paper"}`}
                >
                  <Table2 size={12} /> LIST
                </button>
              </div>
              <div className="hidden items-center gap-1 sm:flex">
                <button onClick={handleExport} className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-muted hover:text-paper" title="Export JSON">
                  <Download size={14} />
                </button>
                <button onClick={() => fileRef.current?.click()} className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-muted hover:text-paper" title="Import JSON">
                  <Upload size={14} />
                </button>
                <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={handleImport} />
              </div>
              <button
                onClick={() => setNewOpen("todo")}
                className="inline-flex items-center gap-1.5 rounded-full bg-paper px-4 py-2 text-sm font-medium text-ink shadow-sm hover:bg-paper/90"
              >
                <Plus size={14} /> New task
              </button>
            </div>
          </div>

          {showFilters && (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-panel-2/40 p-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs font-medium tracking-wide text-faint">PHASE</span>
                {(["ALL", "A", "B", "C", "D", "E"] as const).map((ph) => (
                  <button
                    key={ph}
                    onClick={() => setPhaseFilter(ph as PhaseId | "ALL")}
                    aria-pressed={phaseFilter === ph}
                    className={`rounded-full border px-2.5 py-1 font-mono text-xs font-medium ${phaseFilter === ph ? "border-paper bg-paper text-ink shadow-sm" : "border-line bg-surface text-muted hover:text-paper"}`}
                  >
                    {ph === "ALL" ? "ALL" : `${ph} · ${PHASE_META[ph as PhaseId].label}`}
                  </button>
                ))}
              </div>
              <span className="hidden h-4 w-px bg-line sm:inline" />
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs font-medium tracking-wide text-faint">PRIO</span>
                {(["ALL", "P0", "P1", "P2", "P3"] as const).map((pr) => (
                  <button
                    key={pr}
                    onClick={() => setPrioFilter(pr as Priority | "ALL")}
                    aria-pressed={prioFilter === pr}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-mono text-xs font-medium ${prioFilter === pr ? "border-paper bg-paper text-ink shadow-sm" : "border-line bg-surface text-muted hover:text-paper"}`}
                  >
                    {pr !== "ALL" && <span className="h-1.5 w-1.5 rounded-full" style={{ background: PRIORITY_META[pr as Priority].dot }} />}
                    {pr}
                  </button>
                ))}
              </div>
              <span className="hidden h-4 w-px bg-line sm:inline" />
              <label className="flex min-h-[44px] items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-muted">
                <span className="hidden sm:inline">ASSIGNEE</span>
                <select
                  aria-label="Filter by assignee"
                  value={assigneeFilter}
                  onChange={(e) => setAssigneeFilter(e.target.value as string)}
                  className="bg-transparent font-mono text-xs font-medium text-paper outline-none"
                >
                  <option value="ALL">ALL</option>
                  {CALLSIGNS.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.callsign}
                    </option>
                  ))}
                  <option value="null">Unassigned</option>
                </select>
              </label>
            </div>
          )}
        </div>
      </div>

      {/* board */}
      <main id="main-content" tabIndex={-1} className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 px-4 py-6 sm:px-6">
        {view === "board" ? (
          <div
            className="mt-3 flex gap-4 overflow-x-auto pb-6 snap-x snap-mandatory lg:gap-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-paper"
            style={{ scrollbarWidth: "thin" }}
            tabIndex={0}
            role="region"
            aria-label="Kanban columns — scroll horizontally"
          >
            {COLUMNS.map((col) => {
              const list = byColumn[col.id];
              const over = dragOver === col.id;
              const wip = col.wip;
              const overWip = wip != null && list.length > wip;
              return (
                <section
                  key={col.id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(col.id);
                  }}
                  onDragLeave={() => setDragOver((prev) => (prev === col.id ? null : prev))}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData("text/plain") || dragId;
                    if (id) moveTask(id, col.id);
                    setDragOver(null);
                    setDragId(null);
                  }}
                  className={`flex w-[320px] shrink-0 snap-start flex-col rounded-2xl border bg-surface shadow-sm sm:w-[340px] ${over ? "border-paper ring-2 ring-paper/20" : overWip ? "border-down/30" : "border-line"}`}
                >
                  {/* col header */}
                  <div className={`sticky top-0 z-10 flex flex-col gap-2 rounded-t-2xl border-b px-3 py-3 ${overWip ? "border-down/20 bg-down-soft/60" : "border-line bg-panel-2/60"} backdrop-blur`}>
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="flex items-center gap-2 font-mono text-xs font-semibold tracking-widest text-paper">
                        {col.id === "doing" && <Zap size={12} className="text-amber-600" />}
                        {col.id === "review" && <Shield size={12} className="text-blue-600" />}
                        {col.id === "done" && <Check size={12} className="text-up" />}
                        {col.id === "backlog" && <Layers size={12} className="text-faint" />}
                        {col.id === "todo" && <Clock3 size={12} className="text-faint" />}
                        {col.label}
                        <span className={`rounded-full px-1.5 py-0.5 font-mono text-[11px] ${overWip ? "bg-down-soft text-down border border-down/40" : "bg-paper text-ink"}`}>{list.length}</span>
                        {wip != null && <span className={`font-normal tracking-normal ${overWip ? "text-down" : "text-faint"}`}>/ {wip}</span>}
                      </h2>
                      <button
                        onClick={() => setNewOpen(col.id)}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface text-muted hover:text-paper"
                        title={`Add to ${col.label}`}
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px] text-faint">{col.hint}</span>
                      {overWip && <span className="rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wide bg-down-soft text-down border border-down/40">WIP EXCEEDED</span>}
                    </div>
                    {wip != null && (
                      <div className="h-1 overflow-hidden rounded-full bg-line">
                        <div className={`h-full transition-all ${overWip ? "bg-down" : list.length / wip > 0.7 ? "bg-amber-500" : "bg-paper"}`} style={{ width: `${Math.min(100, (list.length / wip) * 100)}%` }} />
                      </div>
                    )}
                  </div>

                  {/* cards */}
                  <div className={`flex min-h-[280px] flex-1 flex-col gap-2.5 p-2.5 ${over ? "bg-paper/[0.02]" : ""}`}>
                    {list.map((t) => {
                      const doneCheck = t.checklist.filter((c) => c.done).length;
                      const totalCheck = t.checklist.length;
                      const pctCheck = totalCheck ? Math.round((doneCheck / totalCheck) * 100) : 0;
                      const phase = PHASE_META[t.phase];
                      return (
                        <article
                          key={t.id}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", t.id);
                            e.dataTransfer.effectAllowed = "move";
                            setDragId(t.id);
                          }}
                          onDragEnd={() => {
                            setDragId(null);
                            setDragOver(null);
                          }}
                          onClick={() => setSelected(t)}
                          className={`group relative flex cursor-pointer flex-col gap-2.5 rounded-2xl border bg-surface p-3.5 shadow-sm transition hover:shadow-md hover:border-line-strong ${t.blocked ? "border-down/40 bg-down-soft/30" : "border-line"} ${dragId === t.id ? "opacity-50 ring-2 ring-paper/20" : ""}`}
                        >
                          {/* top */}
                          <div className="flex items-start justify-between gap-2">
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel-2 px-2 py-0.5 font-mono text-[11px] font-medium tracking-wide text-muted">
                              <PriorityDot p={t.priority} />
                              {t.id}
                            </span>
                            <span className="inline-flex items-center gap-1 shrink-0">
                              {t.rank && (
                                <span className="rounded-full bg-paper px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wide text-ink">#{t.rank}</span>
                              )}
                              <button
                                className="hidden h-6 w-6 items-center justify-center rounded-full text-faint hover:bg-panel-2 hover:text-paper group-hover:inline-flex"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  duplicateTask(t.id);
                                }}
                                title="Duplicate"
                              >
                                <Copy size={12} />
                              </button>
                              <GripVertical size={12} className="text-faint opacity-60" />
                            </span>
                          </div>

                          <h3 className="line-clamp-2 text-sm font-medium leading-snug text-paper">{t.title}</h3>
                          {t.desc && <p className="line-clamp-2 text-xs leading-relaxed text-muted">{t.desc}</p>}

                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className="rounded-full border bg-surface px-2 py-0.5 font-mono text-[11px] font-medium text-ink dark:text-paper"
                              style={{
                                borderColor: phase.color,
                                background: `color-mix(in srgb, ${phase.color} 16%, var(--color-surface))`,
                              }}
                            >
                              {t.phase} · {phase.label}
                            </span>
                            {t.labels.slice(0, 3).map((l) => (
                              <span key={l} className="rounded-full border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-muted">
                                {l}
                              </span>
                            ))}
                            {t.labels.length > 3 && <span className="font-mono text-[11px] text-faint">+{t.labels.length - 3}</span>}
                          </div>

                          {totalCheck > 0 && (
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-2">
                                <div className="h-full rounded-full bg-paper transition-all" style={{ width: `${pctCheck}%` }} />
                              </div>
                              <span className="font-mono text-[11px] tabular-nums text-faint">
                                {doneCheck}/{totalCheck}
                              </span>
                            </div>
                          )}

                          <div className="mt-1 flex items-center justify-between gap-2 border-t border-line pt-2.5">
                            <div className="flex items-center gap-1.5">
                              <AgentAvatar id={t.assignee} size={22} />
                              <span className="hidden font-mono text-[11px] font-medium tracking-wide text-faint sm:inline">
                                {t.assignee ? AGENT_BY_ID[t.assignee]?.callsign ?? t.assignee : "UNASSIGNED"}
                              </span>
                              {t.blocked && (
                                <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wide bg-down-soft text-down border border-down/40">
                                  <AlertTriangle size={10} /> BLOCKED
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="rounded-full border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-muted">{t.estimate}pt</span>
                              <span className="hidden font-mono text-[11px] tabular-nums text-faint sm:inline">{timeAgo(t.updatedAt)}</span>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                    {list.length === 0 && (
                      <div className={`flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-6 text-center ${over ? "border-paper bg-paper/5" : "border-line bg-panel-2/30"}`}>
                        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-faint">
                          <Plus size={14} />
                        </div>
                        <p className="text-sm font-medium text-muted">No tasks</p>
                        <p className="max-w-[180px] text-xs leading-relaxed text-faint">Drop here or add a new task to {col.label.toLowerCase()}.</p>
                        <button onClick={() => setNewOpen(col.id)} className="mt-1 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-paper hover:bg-panel-2">
                          Add task
                        </button>
                      </div>
                    )}
                    <button
                      onClick={() => setNewOpen(col.id)}
                      className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line bg-transparent px-3 py-2 text-xs font-medium text-muted hover:border-line-strong hover:text-paper"
                    >
                      <Plus size={12} /> Add task
                    </button>
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
            <DataTable
              columns={
                [
                  { key: "id", label: "ID", sortable: true, width: "w-24", render: (r: Task) => <span className="font-mono text-xs font-medium tracking-wide text-muted">{r.id}</span> },
                  { key: "title", label: "Title", sortable: true, render: (r: Task) => <span className="line-clamp-1 font-medium text-paper">{r.title}</span> },
                  {
                    key: "phase",
                    label: "Phase",
                    sortable: true,
                    width: "w-28",
                    render: (r: Task) => {
                      const ph = PHASE_META[r.phase];
                      return <span className="rounded-full border px-2 py-0.5 font-mono text-xs" style={{ borderColor: ph.color, color: ph.color }}>{r.phase}</span>;
                    },
                  },
                  {
                    key: "priority",
                    label: "Prio",
                    sortable: true,
                    width: "w-16",
                    align: "center",
                    render: (r: Task) => <span className="inline-flex items-center gap-1 font-mono text-xs"><PriorityDot p={r.priority} />{r.priority}</span>,
                  },
                  {
                    key: "status",
                    label: "Status",
                    sortable: true,
                    width: "w-28",
                    render: (r: Task) => <span className="rounded-full border border-line bg-panel-2 px-2 py-0.5 font-mono text-xs tracking-wide text-muted">{r.status.toUpperCase()}</span>,
                  },
                  {
                    key: "assignee",
                    label: "Assignee",
                    sortable: true,
                    width: "w-32",
                    render: (r: Task) => (
                      <span className="inline-flex items-center gap-1.5 font-mono text-xs">
                        <AgentAvatar id={r.assignee} size={20} /> {r.assignee ? AGENT_BY_ID[r.assignee]?.callsign ?? r.assignee : "—"}
                      </span>
                    ),
                  },
                  { key: "estimate", label: "Pts", sortable: true, width: "w-14", align: "right", sortValue: (r: Task) => r.estimate, render: (r: Task) => <span className="font-mono tabular-nums">{r.estimate}</span> },
                  {
                    key: "updatedAt",
                    label: "Updated",
                    sortable: true,
                    width: "w-28",
                    align: "right",
                    sortValue: (r: Task) => r.updatedAt,
                    render: (r: Task) => <span className="font-mono text-xs tabular-nums text-faint">{timeAgo(r.updatedAt)}</span>,
                  },
                ] as DTCol<Task>[]
              }
              rows={filtered}
              rowKey={(r) => r.id}
              onRowClick={(r) => setSelected(r)}
              empty="No tasks match filters"
            />
          </div>
        )}

        {/* activity */}
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
            <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-paper">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-paper text-ink">
                <Clock3 size={12} />
              </span>
              Activity feed
              <span className="rounded-full bg-panel-2 px-2 py-0.5 font-mono text-xs text-muted">{activities.length}</span>
            </h3>
            <div
              className="mt-3 flex max-h-[220px] flex-col gap-2 overflow-y-auto pr-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-paper"
              tabIndex={0}
              role="region"
              aria-label="Task checklist — scrollable"
            >
              {activities.length === 0 && <p className="py-6 text-center text-sm text-faint">No moves yet — drag a card to start the trail.</p>}
              {activities.map((a) => (
                <div key={a.id} className="flex items-center gap-3 rounded-xl border border-line bg-panel-2/40 px-3 py-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface font-mono text-[10px] font-bold text-paper shadow-sm">{a.agent.slice(0, 2)}</span>
                  <span className="flex-1 truncate text-sm">
                    <span className="font-mono text-xs font-medium text-paper">{a.taskId}</span> <span className="text-muted">{a.text}</span>
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-faint">{timeAgo(a.at)}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
            <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-paper">
              <Database size={14} className="text-faint" /> Phase breakdown
            </h3>
            <div className="mt-4 grid grid-cols-5 gap-2">
              {(Object.keys(PHASE_META) as PhaseId[]).map((ph) => {
                const c = tasks.filter((t) => t.phase === ph).length;
                const done = tasks.filter((t) => t.phase === ph && t.status === "done").length;
                const pct = c ? Math.round((done / c) * 100) : 0;
                return (
                  <div key={ph} className="rounded-xl border border-line bg-panel-2/40 p-3 text-center">
                    <div
                      className="font-mono text-[11px] font-bold tracking-widest text-ink dark:text-paper"
                      style={{ background: `color-mix(in srgb, ${PHASE_META[ph].color} 18%, transparent)` }}
                    >
                      {ph}
                    </div>
                    <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-paper">{c}</div>
                    <div className="h-1 overflow-hidden rounded-full bg-line">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: PHASE_META[ph].color }} />
                    </div>
                    <div className="mt-1 font-mono text-[10px] tabular-nums text-faint">{done}/{c}</div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 rounded-xl border border-line bg-panel-2 px-3 py-2.5">
              <p className="flex items-center gap-1.5 font-mono text-xs font-medium tracking-wide text-muted">
                <FileText size={12} /> ROADMAP source
              </p>
              <p className="mt-1 text-xs leading-relaxed text-faint">
                30 tasks · Phases A–E map to the product thesis in <span className="font-medium text-paper">ROADMAP.md</span> + <span className="font-medium text-paper">RANKINGS.md</span> jury. Edit any card — it syncs to <span className="font-mono">data/board.json</span> and <span className="font-mono">localStorage</span> for agents + humans.
              </p>
            </div>
          </section>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-xs text-faint">
          <span className="flex items-center gap-2">
            <span className="hidden h-1.5 w-1.5 rounded-full bg-up sm:inline" />
            Board synced · {filtered.length} visible · Press <kbd className="rounded border border-line bg-surface px-1 py-0.5 font-mono">?</kbd> for shortcuts
          </span>
          <span className="flex items-center gap-3">
            <Link href="/" className="hover:text-paper">
              Terminal
            </Link>
            <Link href="/screener" className="hover:text-paper">
              Screener
            </Link>
            <Link href="/breadth" className="hover:text-paper">
              Breadth
            </Link>
            <span className="hidden sm:inline">NIFTY//BOARD · 2026</span>
          </span>
        </footer>
      </main>

      {/* agent picker */}
      <Modal open={agentPickerOpen} onClose={() => setAgentPickerOpen(false)} label="Pick your callsign" panelClassName="max-w-[560px]">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-tight text-paper">Pick your callsign</h3>
          <button onClick={() => setAgentPickerOpen(false)} className="rounded-full border border-line bg-surface p-1 text-muted hover:text-paper">
            <X size={16} />
          </button>
        </div>
        <p className="mb-4 text-sm leading-relaxed text-muted">Every agent needs a cool name. This is your identity on the board — assignee, activity feed, and task ownership. Stored locally + synced to the file.</p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {CALLSIGNS.map((a) => {
            const active = agentId === a.id;
            const count = tasks.filter((t) => t.assignee === a.id).length;
            return (
              <button
                key={a.id}
                onClick={() => {
                  setAgentId(a.id);
                  try { localStorage.setItem(AGENT_KEY, a.id); } catch {}
                  setAgentPickerOpen(false);
                }}
                aria-pressed={active}
                className={`flex flex-col items-center gap-2 rounded-2xl border p-3 text-center transition ${active ? "border-paper bg-paper text-ink shadow-sm" : "border-line bg-surface text-paper hover:border-line-strong hover:bg-panel-2"}`}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 text-xs font-bold text-ink shadow-sm dark:text-paper" style={{ borderColor: a.color, background: `color-mix(in srgb, ${a.color} 20%, var(--color-surface))` }}>
                  {a.glyph}
                </span>
                <span className="font-mono text-xs font-semibold tracking-widest">{a.callsign}</span>
                <span className={`rounded-full px-1.5 py-0.5 font-mono text-[11px] ${active ? "bg-black/10 text-ink" : "bg-panel-2 text-faint"}`}>{count} tasks</span>
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex items-center justify-between rounded-xl border border-line bg-panel-2 px-3 py-2">
          <span className="text-xs text-muted">Current</span>
          <span className="inline-flex items-center gap-2 font-mono text-sm font-semibold tracking-wide text-paper">
            <AgentAvatar id={agentId} size={24} /> {agentId ? AGENT_BY_ID[agentId]?.callsign : "—"}
          </span>
        </div>
      </Modal>

      {/* task detail */}
      <Modal open={!!selected} onClose={() => setSelected(null)} label="Task detail" panelClassName="max-w-[720px] max-h-[88vh] overflow-y-auto">
        {selected && (
          <TaskDetail
            task={tasks.find((t) => t.id === selected.id) ?? selected}
            agentId={agentId}
            onClose={() => setSelected(null)}
            onUpdate={updateTask}
            onDelete={deleteTask}
            onDuplicate={duplicateTask}
            onMove={moveTask}
            pushActivity={pushActivity}
          />
        )}
      </Modal>

      {/* new task */}
      <Modal open={!!newOpen} onClose={() => setNewOpen(null)} label="New task" panelClassName="max-w-[560px]">
        {newOpen && <NewTaskForm col={newOpen} agentId={agentId} onCreate={(d) => createTask(newOpen, d)} onClose={() => setNewOpen(null)} />}
      </Modal>

      {/* help */}
      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} label="Board shortcuts" panelClassName="max-w-[520px]">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-tight text-paper">Board shortcuts</h3>
          <button onClick={() => setHelpOpen(false)} className="rounded-full border border-line bg-surface p-1 text-muted hover:text-paper">
            <X size={16} />
          </button>
        </div>
        <ul className="flex flex-col gap-2 text-sm">
          {[
            ["/ or Ctrl+K", "Focus search"],
            ["N", "New task (to TODO)"],
            ["Drag + Drop", "Move between columns"],
            ["Click card", "Open detail & edit"],
            ["Esc", "Close modals"],
            ["?", "Toggle this help"],
          ].map(([k, v]) => (
            <li key={k} className="flex items-center justify-between gap-4 rounded-xl border border-line bg-panel-2 px-3 py-2">
              <span className="text-muted">{v}</span>
              <kbd className="rounded-full border border-line bg-surface px-2.5 py-1 font-mono text-xs font-medium text-paper">{k}</kbd>
            </li>
          ))}
        </ul>
        <div className="mt-4 rounded-xl border border-line bg-panel-2 p-3">
          <p className="text-xs font-medium tracking-wide text-muted">FOR AGENTS</p>
          <p className="mt-1 font-mono text-xs leading-relaxed text-faint">
            Board state lives at <span className="rounded bg-surface px-1 py-0.5 font-mono text-paper">data/board.json</span> (via{" "}
            <span className="font-mono text-paper">/api/board</span>) and <span className="font-mono text-paper">localStorage:{STORAGE_KEY}</span>. To claim a task: pick a callsign (GHOST, VIPER, … 24 total), click a card, assign to self, drag to DOING. Verify with:{" "}
            <span className="font-mono text-paper">npm run lint</span> + <span className="font-mono text-paper">npx tsc --noEmit</span> → move to REVIEW → DONE blanks.
          </p>
        </div>
      </Modal>
    </div>
  );
}

function TaskDetail({
  task,
  agentId,
  onClose,
  onUpdate,
  onDelete,
  onDuplicate,
  onMove,
  pushActivity,
}: {
  task: Task;
  agentId: string | null;
  onClose: () => void;
  onUpdate: (p: Partial<Task> & { id: string }) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onMove: (id: string, to: ColumnId) => void;
  pushActivity: (id: string, text: string) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [desc, setDesc] = useState(task.desc);
  const [phase, setPhase] = useState<PhaseId>(task.phase);
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [assignee, setAssignee] = useState<string | null>(task.assignee);
  const [estimate, setEstimate] = useState(task.estimate);
  const [labels, setLabels] = useState(task.labels.join(", "));
  const [blocked, setBlocked] = useState(!!task.blocked);
  const [newCheck, setNewCheck] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync form when task prop changes
    setTitle(task.title);
    setDesc(task.desc);
    setPhase(task.phase);
    setPriority(task.priority);
    setAssignee(task.assignee);
    setEstimate(task.estimate);
    setLabels(task.labels.join(", "));
    setBlocked(!!task.blocked);
  }, [task]);

  const save = () => {
    onUpdate({
      id: task.id,
      title: title.trim() || task.title,
      desc,
      phase,
      priority,
      assignee,
      estimate,
      labels: labels
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      blocked,
    });
    pushActivity(task.id, "edited details");
  };

  const toggleCheck = (cid: string) => {
    const next = task.checklist.map((c) => (c.id === cid ? { ...c, done: !c.done } : c));
    onUpdate({ id: task.id, checklist: next });
  };
  const addCheck = () => {
    if (!newCheck.trim()) return;
    onUpdate({ id: task.id, checklist: [...task.checklist, { id: uid(), text: newCheck.trim(), done: false }] });
    setNewCheck("");
  };
  const removeCheck = (cid: string) => {
    onUpdate({ id: task.id, checklist: task.checklist.filter((c) => c.id !== cid) });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 border-b border-line pb-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-line bg-panel-2 px-2 py-0.5 font-mono text-xs font-medium tracking-wide text-muted">{task.id}</span>
            <span className={`rounded-full border px-2 py-0.5 font-mono text-xs font-medium ${PRIORITY_META[priority].bg} border`}>{priority}</span>
            <span
              className="rounded-full border bg-surface px-2 py-0.5 font-mono text-xs font-medium text-ink dark:text-paper"
              style={{
                borderColor: PHASE_META[phase].color,
                background: `color-mix(in srgb, ${PHASE_META[phase].color} 16%, var(--color-surface))`,
              }}
            >
              {phase} · {PHASE_META[phase].label}
            </span>
            {blocked && <span className="rounded-full border border-down/40 bg-down-soft px-2 py-0.5 font-mono text-xs font-bold tracking-wide text-down">BLOCKED</span>}
          </div>
          <p className="mt-2 font-mono text-xs text-faint">Updated {timeAgo(task.updatedAt)} · Created {timeAgo(task.createdAt)}</p>
        </div>
        <button onClick={onClose} className="shrink-0 rounded-full border border-line bg-surface p-1.5 text-muted hover:text-paper">
          <X size={16} />
        </button>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium tracking-wide text-muted">TITLE</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={save} className="rounded-xl border border-line bg-canvas px-3 py-2 text-sm font-medium text-paper focus:border-paper focus:outline-none focus:ring-2 focus:ring-paper/10" />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium tracking-wide text-muted">DESCRIPTION</span>
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} onBlur={save} rows={3} className="rounded-xl border border-line bg-canvas px-3 py-2 text-sm leading-relaxed text-paper placeholder:text-faint focus:border-paper focus:outline-none focus:ring-2 focus:ring-paper/10" placeholder="What needs to be done? Acceptance criteria, notes…" />
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium tracking-wide text-muted">STATUS</span>
          <div className="relative">
            <select aria-label="Status" value={task.status} onChange={(e) => onMove(task.id, e.target.value as ColumnId)} className="h-9 w-full appearance-none rounded-xl border border-line bg-canvas px-3 pr-8 text-sm font-medium text-paper">
              {COLUMNS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-faint" />
          </div>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium tracking-wide text-muted">ASSIGNEE</span>
          <div className="flex gap-2">
            <select value={assignee ?? ""} onChange={(e) => setAssignee(e.target.value || null)} onBlur={save} aria-label="Assignee" className="h-9 flex-1 rounded-xl border border-line bg-canvas px-3 text-sm font-medium text-paper">
              <option value="">Unassigned</option>
              {CALLSIGNS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.callsign}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                if (agentId) {
                  setAssignee(agentId);
                  onUpdate({ id: task.id, assignee: agentId });
                  pushActivity(task.id, `claimed by ${AGENT_BY_ID[agentId]?.callsign}`);
                }
              }}
              className="shrink-0 rounded-full bg-paper px-3 text-xs font-medium text-ink hover:bg-paper/90"
            >
              Claim
            </button>
          </div>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium tracking-wide text-muted">PHASE</span>
          <select aria-label="Phase" value={phase} onChange={(e) => setPhase(e.target.value as PhaseId)} onBlur={save} className="h-9 rounded-xl border border-line bg-canvas px-3 text-sm font-medium text-paper">
            {(Object.keys(PHASE_META) as PhaseId[]).map((ph) => (
              <option key={ph} value={ph}>
                {ph} · {PHASE_META[ph].label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium tracking-wide text-muted">PRIORITY</span>
          <select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value as Priority)} onBlur={save} className="h-9 rounded-xl border border-line bg-canvas px-3 text-sm font-medium text-paper">
            <option value="P0">P0 · CRITICAL</option>
            <option value="P1">P1 · HIGH</option>
            <option value="P2">P2 · MED</option>
            <option value="P3">P3 · LOW</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium tracking-wide text-muted">ESTIMATE (pts)</span>
          <input type="number" min={1} max={13} value={estimate} onChange={(e) => setEstimate(Math.max(1, Number(e.target.value) || 1))} onBlur={save} className="h-9 rounded-xl border border-line bg-canvas px-3 text-sm text-paper" />
        </label>
        <label className="flex items-center gap-2 rounded-xl border border-line bg-panel-2 px-3 py-2">
          <input type="checkbox" checked={blocked} onChange={(e) => setBlocked(e.target.checked)} onBlur={save} className="rounded border-line" />
          <span className="text-sm font-medium text-paper">Blocked</span>
          <span className="font-mono text-xs text-faint">— needs help</span>
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium tracking-wide text-muted">LABELS (comma separated)</span>
        <input value={labels} onChange={(e) => setLabels(e.target.value)} onBlur={save} placeholder="strategy, api, ui" className="rounded-xl border border-line bg-canvas px-3 py-2 font-mono text-sm text-paper placeholder:text-faint" />
      </label>

      <div className="rounded-xl border border-line bg-panel-2/40 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium tracking-wide text-muted">CHECKLIST · {task.checklist.filter((c) => c.done).length}/{task.checklist.length}</span>
          <span className="font-mono text-xs tabular-nums text-faint">{task.checklist.length ? Math.round((task.checklist.filter((c) => c.done).length / task.checklist.length) * 100) : 0}%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-paper" style={{ width: `${task.checklist.length ? (task.checklist.filter((c) => c.done).length / task.checklist.length) * 100 : 0}%` }} />
        </div>
        <div className="mt-3 flex flex-col gap-1.5">
          {task.checklist.map((c) => (
            <label key={c.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5">
              <input type="checkbox" checked={c.done} onChange={() => toggleCheck(c.id)} className="rounded border-line text-paper" />
              <span className={`flex-1 text-sm ${c.done ? "text-faint line-through" : "text-paper"}`}>{c.text}</span>
              <button onClick={() => removeCheck(c.id)} className="rounded-full p-1 text-faint hover:text-down">
                <Trash2 size={12} />
              </button>
            </label>
          ))}
          {task.checklist.length === 0 && <p className="py-2 text-center text-xs text-faint">No checklist — break the task into steps.</p>}
        </div>
        <div className="mt-3 flex gap-2">
          <input value={newCheck} onChange={(e) => setNewCheck(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCheck()} placeholder="Add step… (Enter)" className="flex-1 rounded-full border border-line bg-canvas px-3 py-1.5 text-sm text-paper placeholder:text-faint" />
          <button onClick={addCheck} className="rounded-full bg-paper px-3 py-1.5 text-sm font-medium text-ink">
            Add
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <div className="flex items-center gap-1.5">
          <button onClick={() => onDuplicate(task.id)} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-muted hover:text-paper">
            <Copy size={12} /> Duplicate
          </button>
          <button onClick={() => onDelete(task.id)} className="inline-flex items-center gap-1.5 rounded-full border border-down/20 bg-down-soft px-3 py-1.5 text-xs font-medium text-down hover:bg-down hover:text-white">
            <Trash2 size={12} /> Delete
          </button>
        </div>
        <button onClick={() => { save(); onClose(); }} className="inline-flex items-center gap-1.5 rounded-full bg-paper px-4 py-2 text-sm font-medium text-ink shadow-sm">
          Done <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

function NewTaskForm({ col, agentId, onCreate, onClose }: { col: ColumnId; agentId: string | null; onCreate: (d: Partial<Task>) => void; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [phase, setPhase] = useState<PhaseId>("D");
  const [priority, setPriority] = useState<Priority>("P2");
  const [estimate, setEstimate] = useState(3);
  const [labels, setLabels] = useState("");
  const [assignee, setAssignee] = useState<string | null>(agentId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between border-b border-line pb-3">
        <h3 className="text-sm font-semibold tracking-tight text-paper">
          New task → <span className="font-mono text-muted">{COLUMNS.find((c) => c.id === col)?.label}</span>
        </h3>
        <button onClick={onClose} className="rounded-full border border-line bg-surface p-1 text-muted hover:text-paper">
          <X size={16} />
        </button>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium tracking-wide text-muted">TITLE *</span>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Wire FII/DII flow to board widget" className="rounded-xl border border-line bg-canvas px-3 py-2 text-sm font-medium text-paper placeholder:text-faint focus:border-paper focus:outline-none focus:ring-2 focus:ring-paper/10" />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium tracking-wide text-muted">DESCRIPTION</span>
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} placeholder="Context, AC, links…" className="rounded-xl border border-line bg-canvas px-3 py-2 text-sm leading-relaxed text-paper placeholder:text-faint" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium tracking-wide text-muted">PHASE</span>
          <select value={phase} onChange={(e) => setPhase(e.target.value as PhaseId)} className="h-9 rounded-xl border border-line bg-canvas px-3 text-sm font-medium text-paper">
            {(Object.keys(PHASE_META) as PhaseId[]).map((p) => (
              <option key={p} value={p}>
                {p} · {PHASE_META[p].label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium tracking-wide text-muted">PRIORITY</span>
          <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className="h-9 rounded-xl border border-line bg-canvas px-3 text-sm font-medium text-paper">
            <option value="P0">P0 · CRITICAL</option>
            <option value="P1">P1 · HIGH</option>
            <option value="P2">P2 · MED</option>
            <option value="P3">P3 · LOW</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium tracking-wide text-muted">ESTIMATE</span>
          <input type="number" min={1} max={13} value={estimate} onChange={(e) => setEstimate(Math.max(1, Number(e.target.value) || 1))} className="h-9 rounded-xl border border-line bg-canvas px-3 text-sm text-paper" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium tracking-wide text-muted">ASSIGNEE</span>
          <select value={assignee ?? ""} onChange={(e) => setAssignee(e.target.value || null)} className="h-9 rounded-xl border border-line bg-canvas px-3 text-sm font-medium text-paper">
            <option value="">Unassigned</option>
            {CALLSIGNS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.callsign}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium tracking-wide text-muted">LABELS (comma)</span>
        <input value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="ui, strategy, api" className="rounded-xl border border-line bg-canvas px-3 py-2 font-mono text-sm text-paper placeholder:text-faint" />
      </label>
      <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
        <button onClick={onClose} className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-muted hover:text-paper">
          Cancel
        </button>
        <button
          onClick={() =>
            onCreate({
              title: title.trim() || "Untitled",
              desc,
              phase,
              priority,
              assignee,
              estimate,
              labels: labels
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          disabled={!title.trim()}
          className="inline-flex items-center gap-1.5 rounded-full bg-paper px-4 py-2 text-sm font-medium text-ink shadow-sm hover:bg-paper/90 disabled:opacity-50"
        >
          <Plus size={14} /> Create task
        </button>
      </div>
    </div>
  );
}
