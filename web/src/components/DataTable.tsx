"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

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
  empty = "NO ROWS",
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

  /* clamp instead of resetting state — keeps selection stable across data changes */
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
    <div
      className="relative overflow-auto border border-hairline bg-panel font-mono"
      tabIndex={0}
      role="grid"
      aria-rowcount={rows.length}
      onKeyDown={onKeyDown}
    >
      <table className="w-full border-collapse text-[12px] tabular-nums">
        <thead>
          <tr className="border-b border-hairline-strong">
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
                  className={`sticky top-0 z-10 bg-panel px-3 py-2 text-[9px] tracking-[0.22em] text-faint font-normal ${
                    ALIGN[c.align ?? "left"]
                  } ${c.width ?? ""}`}
                >
                  {c.sortable ? (
                    <button
                      onClick={() => setSort(c)}
                      className={`inline-flex items-center gap-1.5 transition-colors duration-100 hover:text-paper ${
                        key === c.key ? "text-up" : ""
                      } ${c.align === "right" ? "flex-row-reverse" : ""}`}
                    >
                      {c.label}
                      <span aria-hidden>
                        {key === c.key ? (dir === "asc" ? "▲" : "▼") : "⇅"}
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
              <td colSpan={columns.length} className="px-3 py-6 text-center">
                <span className="text-[11px] tracking-[0.25em] text-muted animate-dot-pulse">
                  &gt; LOADING<span className="cursor-blink">_</span>
                </span>
              </td>
            </tr>
          </tbody>
        ) : sorted.length === 0 ? (
          <tbody>
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-6 text-center text-[11px] tracking-[0.25em] text-faint"
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
                  className={`cursor-pointer border-b border-hairline transition-colors duration-75 ${
                    isSel
                      ? "bg-up/10"
                      : isActive
                        ? "bg-panel-2"
                        : "hover:bg-panel-2"
                  }`}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`px-3 py-2 ${ALIGN[c.align ?? "left"]} ${
                        c.rank ? "text-up" : isSel ? "text-paper" : "text-muted"
                      }`}
                    >
                      {c.render ? (
                        c.render(row)
                      ) : c.rank ? (
                        <span className="text-[10px] tracking-widest">
                          {String(i + 1).padStart(2, "0")}
                        </span>
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
