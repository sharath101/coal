import { describe, expect, it } from 'vitest';
import { groupByLine } from './lines';

const spine = { id: 'l2', name: 'Spine' };
const arthroscopy = { id: 'l1', name: 'Arthroscopy' };
const trauma = { id: 'l3', name: 'Trauma' };

describe('groupByLine', () => {
  it('puts the lines in name order and keeps the order of the items within a line', () => {
    const items = [
      { n: 1, line: trauma },
      { n: 2, line: spine },
      { n: 3, line: arthroscopy },
      { n: 4, line: spine },
      { n: 5, line: trauma },
    ];
    const groups = groupByLine(items, (i) => i.line);
    expect(groups.map((g) => g.name)).toEqual(['Arthroscopy', 'Spine', 'Trauma']);
    expect(groups.map((g) => g.items.map((i) => i.n))).toEqual([[3], [2, 4], [1, 5]]);
  });

  it('puts the items that belong to no line last, in one group with no name', () => {
    const items = [
      { n: 1, line: null },
      { n: 2, line: trauma },
      { n: 3, line: undefined },
    ];
    const groups = groupByLine(items, (i) => i.line);
    expect(groups.map((g) => g.name)).toEqual(['Trauma', null]);
    expect(groups[1]?.items.map((i) => i.n)).toEqual([1, 3]);
  });

  it('gives nothing for nothing', () => {
    expect(groupByLine([], () => null)).toEqual([]);
  });
});
