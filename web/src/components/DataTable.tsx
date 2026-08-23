"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronUp, ChevronDown, ArrowUpDown } from "lucide-react";

export type SortDir = "asc" | "desc";

export interface Column<T> {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  width?: string;
  rank?: boolean;
  render?: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  empty?: string;
  loading?: boolean;
  sortKey?: string | null;
  sortDir?: SortDir;
  onSort?: (key: string | null, dir: SortDir) => void;
}

const ALIGN: Record<NonNullable<Column<unknown>["align"]>, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  selectedKey = null,
  empty = "No rows",
  loading = false,
  sortKey = null,
  sortDir = "asc",
  onSort,
}: DataTableProps<T>) {
  const [activeState, setActive] = useState(0);
  const [internalKey, setInternalKey] = useState<string | null>(sortKey);
  const [internalDir, setInternalDir] = useState<SortDir>(sortDir);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  const key = onSort ? sortKey : internalKey;
  const dir = onSort ? sortDir : internalDir;

  const sorted = [...rows];
  if (key) {
    const col = columns.find((c) => c.key === key);
    if (col) {
      const sv =
        col.sortValue ??
        ((r: T) => String((r as Record<string, unknown>)[key]));
      sorted.sort((a, b) => {
        const va = sv(a);
        const vb = sv(b);
        const cmp =
          typeof va === "number" && typeof vb === "number"
            ? va - vb
            : String(va).localeCompare(String(vb));
        return dir === "asc" ? cmp : -cmp;
      });
    }
  }

  const active = Math.min(activeState, Math.max(0, sorted.length - 1));

  useEffect(() => {
    const el = bodyRef.current?.querySelector(`[data-active="true"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const setSort = (col: Column<T>) => {
    if (!col.sortable) return;
    const sameCol = key === col.key;
    const nextKey = sameCol ? (dir === "asc" ? col.key : null) : col.key;
    const nextDir = sameCol ? (dir === "asc" ? "desc" : "asc") : "asc";
    if (onSort) onSort(nextKey, nextDir);
    else {
      setInternalKey(nextKey);
      setInternalDir(nextDir);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!rows.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(rows.length - 1);
    } else if (e.key === "Enter" && onRowClick) {
      e.preventDefault();
      onRowClick(sorted[active]);
    }
  };

  return (
    <div className="overflow-auto rounded-2xl border border-line bg-surface shadow-sm">
      <table
        className="w-full border-collapse text-sm"
        tabIndex={0}
        aria-rowcount={rows.length}
        onKeyDown={onKeyDown}
      >
        <thead>
          <tr className="border-b border-line bg-panel-2/60">
            {columns.map((c) => {
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={
                    c.sortable && key === c.key
                      ? dir === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                  className={`sticky top-0 z-10 bg-panel-2/90 px-3 py-2.5 text-xs font-medium tracking-wide text-muted backdrop-blur ${
                    ALIGN[c.align ?? "left"]
                  } ${c.width ?? ""}`}
                >
                  {c.sortable ? (
                    <button
                      onClick={() => setSort(c)}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 transition-colors hover:bg-surface ${key === c.key ? "bg-paper text-ink shadow-sm" : ""} ${c.align === "right" ? "flex-row-reverse" : ""}`}
                    >
                      {c.label}
                      <span aria-hidden className="text-faint">
                        {key === c.key ? (dir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ArrowUpDown size={12} />}
                      </span>
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        {loading ? (
          <tbody>
            <tr>
              <td colSpan={columns.length} className="px-3 py-10 text-center">
                <span className="inline-flex items-center gap-2 rounded-full bg-panel-2 px-4 py-2 text-sm text-muted">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-faint" /> Loading…
                </span>
              </td>
            </tr>
          </tbody>
        ) : sorted.length === 0 ? (
          <tbody>
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-10 text-center text-sm text-faint"
              >
                {empty}
              </td>
            </tr>
          </tbody>
        ) : (
          <tbody ref={bodyRef}>
            {sorted.map((row, i) => {
              const rk = rowKey(row);
              const isSel = selectedKey === rk;
              const isActive = i === active;
              return (
                <tr
                  key={rk}
                  data-active={isActive}
                  aria-selected={isSel}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onMouseEnter={() => setActive(i)}
                  className={`cursor-pointer border-b border-line/70 last:border-0 transition-colors ${
                    isSel
                      ? "bg-paper text-ink"
                      : isActive
                        ? "bg-canvas"
                        : "hover:bg-canvas"
                  }`}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`px-3 py-2.5 text-sm ${ALIGN[c.align ?? "left"]} ${isSel ? "text-ink" : c.rank ? "font-mono font-medium tabular-nums text-muted" : "text-paper"}`}
                    >
                      {c.render ? (
                        c.render(row)
                      ) : c.rank ? (
                        <span className="text-xs">{String(i + 1).padStart(2, "0")}</span>
                      ) : (
                        String((row as Record<string, unknown>)[c.key] ?? "—")
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        )}
      </table>
    </div>
  );
}
