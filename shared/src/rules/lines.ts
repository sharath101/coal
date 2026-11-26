/**
 * Lists of projects and of work are divided by product line (docs/dashboard.md#widgets, P114). One
 * pure rule, so the server, the website and the later app order them the same way.
 */

export interface LineGroup<T> {
  /** The product line's id; empty for the items that belong to no line. */
  key: string;
  /** The product line's name, the heading; null for the items that belong to no line. */
  name: string | null;
  items: T[];
}

/**
 * Groups items under the product line they belong to: the lines by name, the items on no line
 * last, and the items of each line in the order they came.
 */
export function groupByLine<T>(
  items: readonly T[],
  lineOf: (item: T) => { id: string; name: string } | null | undefined,
): LineGroup<T>[] {
  const byLine = new Map<string, LineGroup<T>>();
  const onNoLine: T[] = [];
  for (const item of items) {
    const line = lineOf(item);
    if (!line) {
      onNoLine.push(item);
      continue;
    }
    const group = byLine.get(line.id) ?? { key: line.id, name: line.name, items: [] };
    group.items.push(item);
    byLine.set(line.id, group);
  }
  const groups = [...byLine.values()].sort(
    (a, b) => (a.name ?? '').localeCompare(b.name ?? '') || a.key.localeCompare(b.key),
  );
  return onNoLine.length > 0 ? [...groups, { key: '', name: null, items: onNoLine }] : groups;
}
