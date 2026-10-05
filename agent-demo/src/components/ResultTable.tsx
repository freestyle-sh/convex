import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useContext, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { ResultTable as Table } from "../../convex/lib/notebook";
import {
  sortedRows,
  tableSelection,
  type Cell,
  type SelectResult,
} from "../results";
import { OverlayContainer } from "../overlayContainer";
import { SelectionActions } from "./SelectionActions";

const valueOf = (cell: Cell) =>
  cell == null || cell === "" ? "—" : String(cell);

export function ResultTable({
  table,
  sourceId,
  onSelect,
  embedded = false,
  fill = false,
  rowLabelColumn = 0,
}: {
  table: Table;
  sourceId: string;
  onSelect?: SelectResult;
  embedded?: boolean;
  fill?: boolean;
  rowLabelColumn?: number;
}) {
  const overlayContainer = useContext(OverlayContainer);
  const [sort, setSort] = useState<{
    column: number | null;
    direction: "asc" | "desc";
  }>({ column: null, direction: "asc" });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);
  const signature = JSON.stringify(table);
  useEffect(() => {
    setSelected([]);
    setPage(0);
  }, [signature]);
  const rows = useMemo(
    () => sortedRows(table.rows, sort.column, sort.direction),
    [table.rows, sort],
  );
  const pageCount = Math.max(1, Math.ceil(rows.length / 10));
  const current = Math.min(page, pageCount - 1);
  const visibleRows = rows.slice(current * 10, (current + 1) * 10);
  const sortBy = (column: number) => {
    setSort({
      column,
      direction:
        sort.column === column && sort.direction === "asc" ? "desc" : "asc",
    });
    setPage(0);
  };
  const checkbox = (index: number) => (
    <input
      type="checkbox"
      aria-label={`Select row ${index + 1}`}
      checked={selected.includes(index)}
      disabled={!selected.includes(index) && selected.length >= 5}
      onChange={(event) => {
        const checked = event.target.checked;
        setSelected((previous) =>
          checked
            ? [...previous, index].slice(0, 5)
            : previous.filter((i) => i !== index),
        );
      }}
      className="m-0 size-4 shrink-0 cursor-pointer rounded border-zinc-300 p-0 accent-accent-plum disabled:opacity-30"
    />
  );
  return (
    <section
      className={`result-table @container/table flex min-h-0 min-w-0 flex-col overflow-hidden ${fill ? "h-full" : ""} ${embedded ? "" : "rounded-xl border border-line bg-surface"}`}
      aria-label={table.title}
    >
      <div className="shrink-0 px-2 pb-2 text-xs">
        <div className="flex min-h-10 min-w-0 items-center justify-between gap-2">
          <span className="min-w-0 text-ink-3">
            {!embedded && (
              <span className="mr-2 font-medium [overflow-wrap:anywhere] text-ink">
                {table.title}
              </span>
            )}
            {table.rows.length} {table.rows.length === 1 ? "row" : "rows"}
          </span>
          <div className="shrink-0 @min-[480px]/table:hidden">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  aria-label="Sort rows"
                  className="min-h-10 max-w-44 gap-1.5 rounded-lg px-2 text-ink-2 hover:bg-hover"
                >
                  <span className="truncate">
                    {sort.column === null ? "Sort" : table.columns[sort.column]}
                  </span>
                  {sort.column === null ? (
                    <ArrowUpDown size={13} />
                  ) : sort.direction === "asc" ? (
                    <ArrowUp size={13} />
                  ) : (
                    <ArrowDown size={13} />
                  )}
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal container={overlayContainer ?? undefined}>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={4}
                  collisionPadding={12}
                  className="z-50 max-h-72 w-56 max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-line bg-surface p-1 text-xs text-ink shadow-lg"
                >
                  <DropdownMenu.Label className="px-3 py-2 text-ink-3">
                    Sort by
                  </DropdownMenu.Label>
                  {table.columns.map((column, index) => (
                    <DropdownMenu.Item
                      key={index}
                      onSelect={() => sortBy(index)}
                      className="flex min-h-10 cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 outline-none data-highlighted:bg-hover"
                    >
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        {column}
                      </span>
                      {sort.column === index &&
                        (sort.direction === "asc" ? (
                          <ArrowUp size={13} />
                        ) : (
                          <ArrowDown size={13} />
                        ))}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>
        {!!selected.length && (
          <SelectionActions
            label={`${selected.length} selected`}
            clearLabel="Clear selected rows"
            investigate={() =>
              onSelect?.(tableSelection(table, selected, sourceId))
            }
            clear={() => setSelected([])}
          />
        )}
      </div>
      <div
        className={`min-h-0 overflow-auto overscroll-contain ${fill ? "flex-1" : "max-h-96"}`}
        tabIndex={0}
        role="region"
        aria-label={`${table.title} rows`}
      >
        <ul className="space-y-2 @min-[480px]/table:hidden">
          {visibleRows.map(({ cells, index }) => (
            <li
              key={index}
              className={`overflow-hidden rounded-xl border ${selected.includes(index) ? "border-accent-plum/30 bg-selection/40" : "border-line bg-surface"}`}
            >
              <label
                className={`relative m-0 flex min-h-11 items-center gap-3 px-3 py-2 text-xs font-medium text-ink ${onSelect ? "cursor-pointer" : ""}`}
              >
                {onSelect && checkbox(index)}
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  <span className="sr-only">
                    {table.columns[rowLabelColumn]}:{" "}
                  </span>
                  {valueOf(cells[rowLabelColumn])}
                </span>
                <span className="ml-auto shrink-0 text-[10px] font-normal text-ink-3">
                  #{index + 1}
                </span>
              </label>
              <dl className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-x-3 gap-y-1.5 px-3 pb-3 text-xs leading-5">
                {table.columns.map((column, col) =>
                  col === rowLabelColumn ? null : (
                    <div key={col} className="contents">
                      <dt className="[overflow-wrap:anywhere] text-ink-3">
                        {column}
                      </dt>
                      <dd className="m-0 min-w-0 [overflow-wrap:anywhere] text-ink-2">
                        {valueOf(cells[col])}
                      </dd>
                    </div>
                  ),
                )}
              </dl>
            </li>
          ))}
        </ul>
        <table className="hidden w-full border-collapse text-left text-xs leading-5 tabular-nums @min-[480px]/table:table">
          <thead className="sticky top-0 z-[2] bg-field">
            <tr>
              {onSelect && (
                <th scope="col" className="sticky left-0 w-11 bg-field">
                  <span className="sr-only">Select up to 5 rows</span>
                </th>
              )}
              {table.columns.map((column, index) => (
                <th
                  key={index}
                  scope="col"
                  aria-sort={
                    sort.column === index
                      ? sort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                  className="border-b border-line px-3 font-medium whitespace-nowrap text-ink-2"
                >
                  <button
                    type="button"
                    className="min-h-10 justify-start gap-1.5 hover:text-ink"
                    aria-label={`Sort by ${column}`}
                    onClick={() => sortBy(index)}
                  >
                    {column}
                    {sort.column === index ? (
                      sort.direction === "asc" ? (
                        <ArrowUp size={12} />
                      ) : (
                        <ArrowDown size={12} />
                      )
                    ) : (
                      <ArrowUpDown size={12} className="text-zinc-400" />
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(({ cells, index }) => (
              <tr
                key={index}
                className={`border-b border-line last:border-b-0 ${selected.includes(index) ? "bg-selection" : "bg-surface hover:bg-zinc-50"}`}
              >
                {onSelect && (
                  <td className="sticky left-0 z-[1] bg-inherit">
                    <label className="m-0 flex size-11 cursor-pointer items-center justify-center">
                      {checkbox(index)}
                    </label>
                  </td>
                )}
                {cells.map((cell, col) => (
                  <td
                    key={col}
                    className={`max-w-80 min-w-20 px-3 py-2 text-ink-2 ${typeof cell === "number" ? "text-right" : ""}`}
                  >
                    <span className="block max-w-80 [overflow-wrap:anywhere] whitespace-normal">
                      {valueOf(cell)}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="px-3 py-5 text-xs text-ink-3">
            No rows in this result.
          </p>
        )}
      </div>
      {(pageCount > 1 || table.truncated) && (
        <div className="flex shrink-0 items-center justify-between gap-2 px-2 pt-2 text-[11px] text-ink-3">
          <span>
            {table.truncated
              ? `Showing ${rows.length} of ${table.totalRows ?? "more"} rows · bounded preview`
              : `${current * 10 + 1}–${Math.min((current + 1) * 10, rows.length)} of ${rows.length}`}
          </span>
          {pageCount > 1 && (
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                aria-label="Previous table page"
                disabled={current === 0}
                onClick={() => setPage(current - 1)}
                className="size-10 rounded-lg hover:bg-hover"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                aria-label="Next table page"
                disabled={current + 1 >= pageCount}
                onClick={() => setPage(current + 1)}
                className="size-10 rounded-lg hover:bg-hover"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
