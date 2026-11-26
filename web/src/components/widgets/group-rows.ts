import { groupByLine, type LineGroup, type WidgetRow } from '@coal/shared';

/** The subtitle of a row, unless it only repeats the heading the row sits under. */
export const subtitleOf = (row: WidgetRow): string | null =>
  row.subtitle && row.subtitle !== row.group?.name ? row.subtitle : null;

/**
 * Splits a widget's rows into product lines (the server already put them together). `grouped` is
 * false when no row has a group: such a widget has no headings.
 */
export function groupRows(rows: WidgetRow[]): { grouped: boolean; groups: LineGroup<WidgetRow>[] } {
  return {
    grouped: rows.some((r) => r.group),
    groups: groupByLine(rows, (r) => r.group && { id: r.group.key, name: r.group.name }),
  };
}
