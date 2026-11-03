import { describe, expect, it } from 'vitest';
import type { Group, Page } from '../src/types';
import { childSummaries, groupAncestors, groupSummaries, searchGroups, searchTags, tagSummaries } from '../src/lib/browse';

const g = (id: string, name: string, parentId: string | null = null): Group => ({ id, name, color: 'blue', parentId });
const page = (id: string, groupId: string | null, tags: string[] = []) => ({ id, groupId, tags }) as unknown as Page;

const groups = [g('w', 'Work'), g('ml', 'ML projects', 'w'), g('p', 'Personal'), g('d', 'Deep work', 'ml')];
const pages = [page('1', 'w'), page('2', 'ml'), page('3', 'd'), page('4', 'p'), page('5', null)];

describe('the Groups page', () => {
  const all = groupSummaries(groups, pages);
  const by = (id: string) => all.find((s) => s.group.id === id)!;

  it('counts pages including subgroups, and direct subgroups', () => {
    expect(by('w').pages).toBe(3);
    expect(by('w').subgroups).toBe(1);
    expect(by('ml').pages).toBe(2);
    expect(by('d').pages).toBe(1);
    expect(by('d').subgroups).toBe(0);
    expect(by('p').pages).toBe(1);
  });

  it('lists the top level, or the subgroups of one group, by name', () => {
    expect(childSummaries(all, null).map((s) => s.group.name)).toEqual(['Personal', 'Work']);
    expect(childSummaries(all, 'w').map((s) => s.group.name)).toEqual(['ML projects']);
  });

  it('gives the path and the ancestors for navigating back up', () => {
    expect(by('d').path).toEqual(['Work', 'ML projects', 'Deep work']);
    expect(groupAncestors(groups, 'd').map((x) => x.id)).toEqual(['w', 'ml']);
    expect(groupAncestors(groups, 'w')).toEqual([]);
  });

  it('searches groups at every depth, by name or by where they sit', () => {
    expect(searchGroups(all, '').map((s) => s.group.id)).toEqual(['p', 'w']); // no search: the top level
    expect(searchGroups(all, 'deep').map((s) => s.group.id)).toEqual(['d']);
    expect(searchGroups(all, 'work ml').map((s) => s.group.id)).toEqual(['d', 'ml']);
    expect(searchGroups(all, 'nothing')).toEqual([]);
  });

  it('puts groups whose own name matches before ones that only sit under a match', () => {
    const ids = searchGroups(all, 'work').map((s) => s.group.id);
    expect(ids.slice(0, 2)).toEqual(['d', 'w']); // "Deep work" and "Work" match by name
    expect(ids[2]).toBe('ml'); // only its parent matches
  });
});

describe('the Tags page', () => {
  const tags = tagSummaries([page('1', null, ['ideas', 'canvas']), page('2', null, ['ideas']), page('3', null, ['idea-box'])]);

  it('counts the pages of each tag', () => {
    expect(tags.find((t) => t.tag === 'ideas')!.count).toBe(2);
    expect(tags).toHaveLength(3);
  });

  it('searches tags, ignoring a leading # and case', () => {
    expect(searchTags(tags, '#IDEA', 'name').map((t) => t.tag)).toEqual(['idea-box', 'ideas']);
    expect(searchTags(tags, 'canv', 'name').map((t) => t.tag)).toEqual(['canvas']);
    expect(searchTags(tags, 'zzz', 'name')).toEqual([]);
    expect(searchTags(tags, '', 'name')).toHaveLength(3);
  });

  it('sorts by name or by most used', () => {
    expect(searchTags(tags, '', 'name').map((t) => t.tag)).toEqual(['canvas', 'idea-box', 'ideas']);
    expect(searchTags(tags, '', 'count')[0].tag).toBe('ideas');
  });
});
