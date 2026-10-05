export type ResultLayout = {
  mode: "grid" | "stack";
  order: string[];
  collapsed: string[];
  wide: string[];
};
export const defaultResultLayout: ResultLayout = {
  mode: "grid",
  order: [],
  collapsed: [],
  wide: [],
};
export function readResultLayout(raw: string | null): ResultLayout {
  try {
    const value = JSON.parse(raw ?? "null");
    const ids = (items: unknown): string[] =>
      Array.isArray(items)
        ? [
            ...new Set(
              items.filter(
                (id): id is string =>
                  typeof id === "string" && id.length <= 256,
              ),
            ),
          ].slice(0, 100)
        : [];
    return {
      mode: value?.mode === "stack" ? "stack" : "grid",
      order: ids(value?.order),
      collapsed: ids(value?.collapsed),
      wide: ids(value?.wide),
    };
  } catch {
    return { ...defaultResultLayout };
  }
}
export function orderedResults(order: string[], available: string[]) {
  const current = new Set(available);
  return [...new Set([...order.filter((id) => current.has(id)), ...available])];
}
export function moveResult(order: string[], source: string, target: string) {
  const from = order.indexOf(source),
    to = order.indexOf(target);
  if (from < 0 || to < 0 || from === to) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, source);
  return next;
}
export function toggleResult(ids: string[], id: string) {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
}
