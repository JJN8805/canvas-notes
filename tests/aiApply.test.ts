import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/components/library/Thumbnail', () => ({ StaticBody: () => null }));
vi.mock('../src/store/ui', () => ({ toast: () => {}, openMenu: () => {}, useUi: { getState: () => ({}) } }));

import { applyChanges } from '../src/addons/ai/applyEdits';
import { buildEditableContext, propose, type EditOp } from '../src/addons/ai/edits';
import { undo, updateBlock, useNotes } from '../src/store/notes';
import type { Block, Page } from '../src/types';

const text = (id: string, html: string, y: number): Block => ({ id, type: 'text', x: 0, y, w: 200, h: 40, z: 1, html }) as Block;
const list = (id: string, y: number): Block => ({ id, type: 'checklist', x: 0, y, w: 200, h: 40, z: 2, items: [{ id: 'i1', text: 'Milk', done: false }] }) as Block;
const mk = (blocks: Block[]): Page => ({ id: 'p', title: 'Shopping', groupId: null, tags: [], blocks, arrows: [], created: 1, updated: 1, rev: 1 });
const cur = () => useNotes.getState().pages.p;

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
  useNotes.setState({ pages: { p: mk([text('t1', '<p>Helo wrld</p>', 0), list('c1', 100)]) } });
});

/** What the panel does: show the page, get the model's list, turn it into a proposal. */
const proposal = (ops: EditOp[]) => {
  const { aliases } = buildEditableContext(cur());
  return { aliases, changes: propose(ops, aliases, cur().blocks) };
};

describe('applying the assistant\'s changes', () => {
  it('changes nothing until applied', () => {
    const before = cur().blocks;
    proposal([{ kind: 'text', box: 'b1', markdown: 'Hello world' }]);
    expect(cur().blocks).toBe(before);
  });

  it('changes an existing box and several at once as ONE undo step', () => {
    const { aliases, changes } = proposal([
      { kind: 'text', box: 'b1', markdown: 'Hello world' },
      { kind: 'checklist', box: 'b2', items: [{ text: 'Milk', done: true }, { text: 'Bread', done: false }] },
      { kind: 'add', what: 'text', markdown: 'A new note' },
    ]);
    const r = applyChanges('p', changes, aliases);
    expect(r).toMatchObject({ applied: 3, skipped: 0 });
    expect(cur().blocks).toHaveLength(3);
    expect(cur().blocks.find((b) => b.id === 't1')).toMatchObject({ html: '<p>Hello world</p>' });
    const l = cur().blocks.find((b) => b.id === 'c1') as Extract<Block, { type: 'checklist' }>;
    expect(l.items.map((i) => [i.id === 'i1', i.text, i.done])).toEqual([[true, 'Milk', true], [false, 'Bread', false]]);
    expect(undo('p')).toBe(true); // one step back restores all three
    expect(cur().blocks).toHaveLength(2);
    expect(cur().blocks.find((b) => b.id === 't1')).toMatchObject({ html: '<p>Helo wrld</p>' });
    expect((cur().blocks.find((b) => b.id === 'c1') as Extract<Block, { type: 'checklist' }>).items).toHaveLength(1);
  });

  it('deletes a box on request, and undo brings it back', () => {
    const { aliases, changes } = proposal([{ kind: 'delete', box: 'b2' }]);
    expect(applyChanges('p', changes, aliases).applied).toBe(1);
    expect(cur().blocks.map((b) => b.id)).toEqual(['t1']);
    undo('p');
    expect(cur().blocks.map((b) => b.id)).toEqual(['t1', 'c1']);
  });

  it('never overwrites a box the user edited while the proposal was open', () => {
    const { aliases, changes } = proposal([{ kind: 'text', box: 'b1', markdown: 'Hello world' }]);
    expect(changes[0].problem).toBeUndefined(); // looked fine when proposed …
    updateBlock('p', 't1', (b) => void ((b as { html: string }).html = '<p>I kept typing</p>')); // … then the user typed
    const r = applyChanges('p', changes, aliases);
    expect(r).toMatchObject({ applied: 0, skipped: 1 });
    expect(cur().blocks.find((b) => b.id === 't1')).toMatchObject({ html: '<p>I kept typing</p>' });
  });

  it('skips a change that had a problem and still applies the rest', () => {
    const { aliases, changes } = proposal([{ kind: 'code', box: 'b1', code: 'x' }, { kind: 'text', box: 'b1', markdown: 'ok' }]);
    const r = applyChanges('p', changes, aliases);
    expect(r.applied).toBe(1);
    expect(r.skipped).toBe(1);
  });

  it('cannot reach a box that was not in what was shown', () => {
    const { aliases } = buildEditableContext(cur(), ['t1']); // only b1 was shown
    const changes = propose([{ kind: 'delete', box: 'b2' }], aliases, cur().blocks);
    expect(applyChanges('p', changes, aliases).applied).toBe(0);
    expect(cur().blocks).toHaveLength(2);
  });
});
