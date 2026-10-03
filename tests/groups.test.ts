import { describe, expect, it } from 'vitest';
import { effectiveParents, groupPath, groupTree, validParents, withDescendants } from '../src/lib/groups';
import type { Group } from '../src/types';

const g = (id: string, parentId: string | null = null): Group => ({ id, name: id.toUpperCase(), color: 'teal', parentId });

const groups = [g('work'), g('home'), g('ml', 'work'), g('gw', 'ml'), g('reports', 'work'), g('garden', 'home')];

describe('group tree', () => {
  it('lists each group followed by its subgroups, with depth', () => {
    expect(groupTree(groups).map((r) => `${'  '.repeat(r.depth)}${r.group.id}${r.hasChildren ? '+' : ''}`)).toEqual([
      'work+', '  ml+', '    gw', '  reports', 'home+', '  garden',
    ]);
  });

  it('hides subgroups of collapsed groups but still marks them as having children', () => {
    expect(groupTree(groups, new Set(['work'])).map((r) => r.group.id)).toEqual(['work', 'home', 'garden']);
    expect(groupTree(groups, new Set(['work']))[0].hasChildren).toBe(true);
  });

  it('finds a group and everything nested inside it', () => {
    expect([...withDescendants(groups, 'work')].sort()).toEqual(['gw', 'ml', 'reports', 'work']);
    expect([...withDescendants(groups, 'gw')]).toEqual(['gw']);
  });

  it('builds the path shown as the page title', () => {
    expect(groupPath(groups, 'gw')).toEqual(['WORK', 'ML', 'GW']);
  });

  it('never offers a group (or its subgroups) as its own new parent', () => {
    expect(validParents(groups, 'work').map((x) => x.id).sort()).toEqual(['garden', 'home']);
    expect(validParents(groups, 'ml').map((x) => x.id).sort()).toEqual(['garden', 'home', 'reports', 'work']);
  });

  it('treats a group whose parent was deleted as top level', () => {
    const rows = groupTree([g('a', 'gone'), g('b', 'a')]);
    expect(rows.map((r) => [r.group.id, r.depth])).toEqual([['a', 0], ['b', 1]]);
  });

  it('breaks loops from two devices moving groups into each other, keeping every group visible', () => {
    // Laptop moved A into B while the phone moved B into A.
    const loop = [g('a', 'b'), g('b', 'a'), g('c', 'b')];
    const parents = effectiveParents(loop);
    expect(parents.get('a')).toBeNull(); // first loop member lifted to top level
    expect(parents.get('b')).toBe('a');
    expect(groupTree(loop).map((r) => [r.group.id, r.depth])).toEqual([['a', 0], ['b', 1], ['c', 2]]);
  });

  it('handles longer loops and a group set as its own parent', () => {
    const loop = [g('x', 'z'), g('y', 'x'), g('z', 'y'), g('self', 'self')];
    const rows = groupTree(loop);
    expect(rows.map((r) => r.group.id).sort()).toEqual(['self', 'x', 'y', 'z']);
    expect(rows.find((r) => r.group.id === 'self')?.depth).toBe(0);
  });
});
