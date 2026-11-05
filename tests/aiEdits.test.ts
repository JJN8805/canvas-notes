import { describe, expect, it } from 'vitest';
import { buildEditableContext, cleanOp, EDIT_PROMPT, fieldsFor, fingerprint, parseAnswer, propose, visibleText } from '../src/addons/ai/edits';
import type { Block } from '../src/types';

const text = (id: string, html: string, y = 0): Block => ({ id, type: 'text', x: 0, y, w: 200, h: 40, z: 1, html }) as Block;
const list = (id: string, y: number): Block =>
  ({ id, type: 'checklist', x: 0, y, w: 200, h: 40, z: 1, items: [{ id: 'i1', text: 'Milk', done: false }, { id: 'i2', text: 'Eggs', done: true }] }) as Block;
const pic = (id: string, y: number): Block => ({ id, type: 'image', x: 0, y, w: 100, h: 100, z: 1, imageId: 'x', aspect: 1 }) as Block;
const page = (blocks: Block[]) => ({ title: 'Shopping', tags: [], blocks });

describe('what the assistant is shown', () => {
  it('labels each editable box in reading order and keeps real ids out of the text', () => {
    const p = page([list('real-2', 100), text('real-1', '<p>Hello</p>', 0), pic('real-3', 300)]);
    const c = buildEditableContext(p);
    expect(c.text).toContain('[b1: text box]\nHello');
    expect(c.text).toContain('[b2: checklist]\n- [ ] Milk');
    expect(c.text).not.toContain('real-');
    expect(Object.keys(c.aliases)).toEqual(['b1', 'b2']);
    expect(c.aliases.b1.id).toBe('real-1');
  });
  it('with a selection shows only those boxes, keeping their labels', () => {
    const p = page([text('a', '<p>One</p>', 0), text('b', '<p>Two</p>', 100)]);
    const c = buildEditableContext(p, ['b']);
    expect(c.usedSelection).toBe(true);
    expect(c.text).toContain('[b2: text box]\nTwo');
    expect(c.text).not.toContain('One');
    expect(Object.keys(c.aliases)).toEqual(['b2']);
  });
  it('gives no label to boxes cut off by the length limit, so they cannot be changed', () => {
    const p = page([text('a', '<p>' + 'x'.repeat(50) + '</p>', 0), text('b', '<p>' + 'y'.repeat(50) + '</p>', 100)]);
    const c = buildEditableContext(p, [], 80);
    expect(c.truncated).toBe(true);
    expect(Object.keys(c.aliases)).toEqual(['b1']);
  });
  it('tells the model that nothing is changed until the user decides', () => {
    expect(EDIT_PROMPT).toMatch(/NOT made when you answer/);
  });
});

describe('reading the answer', () => {
  const answer = 'I fixed the spelling.\n```edits\n[{"op":"text","box":"b1","markdown":"Hello **world**"}]\n```';
  it('separates the words from the changes', () => {
    const r = parseAnswer(answer);
    expect(r.message).toBe('I fixed the spelling.');
    expect(r.ops).toEqual([{ kind: 'text', box: 'b1', markdown: 'Hello **world**' }]);
  });
  it('hides the block while it is still being written', () => {
    expect(visibleText('Working on it\n```edits\n[{"op":"te')).toBe('Working on it');
  });
  it('treats an answer without a block, or with broken JSON, as having no changes', () => {
    expect(parseAnswer('Just an answer').ops).toEqual([]);
    const bad = parseAnswer('Hi\n```edits\n[{"op":\n```');
    expect(bad.ops).toEqual([]);
    expect(bad.dropped).toBe(1);
  });
  it('drops malformed entries but keeps the good ones, and says how many', () => {
    const r = parseAnswer('x\n```edits\n[{"op":"text","box":"b1","markdown":"ok"},{"op":"explode","box":"b1"},{"op":"code"},5]\n```');
    expect(r.ops).toHaveLength(1);
    expect(r.dropped).toBe(3);
  });
  it('limits the number of changes', () => {
    const many = JSON.stringify(Array.from({ length: 30 }, () => ({ op: 'delete', box: 'b1' })));
    const r = parseAnswer('```edits\n' + many + '\n```');
    expect(r.ops).toHaveLength(20);
    expect(r.dropped).toBe(10);
  });
  it('cleans each kind of change', () => {
    expect(cleanOp({ op: 'checklist', box: 'B2', items: ['a', { text: 'b', done: true }] })).toEqual({ kind: 'checklist', box: 'b2', items: [{ text: 'a', done: false }, { text: 'b', done: true }] });
    expect(cleanOp({ op: 'table', box: 'b1', rows: [['a', 'b'], ['c']] })).toEqual({ kind: 'table', box: 'b1', rows: [['a', 'b'], ['c', '']] });
    expect(cleanOp({ op: 'table', box: 'b1', rows: [] })).toBeNull();
    expect(cleanOp({ op: 'add', what: 'picture' })).toBeNull();
    expect(cleanOp({ op: 'text', box: 'b1', markdown: 5 })).toBeNull();
  });
});

describe('proposing changes against the page', () => {
  const blocks = [text('t1', '<p>Helo</p>'), list('c1', 100)];
  const { aliases } = buildEditableContext(page(blocks));
  it('shows before and after for a text box', () => {
    const [c] = propose([{ kind: 'text', box: 'b1', markdown: 'Hello' }], aliases, blocks);
    expect(c.problem).toBeUndefined();
    expect(c.before).toBe('Helo');
    expect(c.after).toBe('Hello');
    expect(c.id).toBe('t1');
  });
  it('refuses a label the model was never shown', () => {
    expect(propose([{ kind: 'delete', box: 'b9' }], aliases, blocks)[0].problem).toMatch(/not on the page/);
  });
  it('refuses a change of the wrong kind', () => {
    expect(propose([{ kind: 'code', box: 'b1', code: 'x' }], aliases, blocks)[0].problem).toMatch(/doesn't fit/);
  });
  it('leaves alone a box edited after the page was sent', () => {
    const edited = [text('t1', '<p>Someone typed here</p>'), blocks[1]];
    expect(propose([{ kind: 'text', box: 'b1', markdown: 'Hello' }], aliases, edited)[0].problem).toMatch(/changed after/);
  });
  it('notices a box that is gone, and a second change to the same box', () => {
    expect(propose([{ kind: 'delete', box: 'b1' }], aliases, [blocks[1]])[0].problem).toMatch(/no longer/);
    const two = propose([{ kind: 'text', box: 'b1', markdown: 'a' }, { kind: 'text', box: 'b1', markdown: 'b' }], aliases, blocks);
    expect(two[1].problem).toMatch(/Another change/);
  });
  it('does not touch the generated attendance table', () => {
    const att = { id: 'at', type: 'table', x: 0, y: 0, w: 1, h: 1, z: 1, rows: [['a']], attendance: { pageId: 'p', blockId: 'b' } } as unknown as Block;
    expect(buildEditableContext(page([att])).aliases).toEqual({});
  });
});

describe('what an accepted change writes', () => {
  it('turns Markdown into escaped HTML', () => {
    expect(fieldsFor({ kind: 'text', box: 'b1', markdown: '**hi** <script>' })).toEqual({ html: '<p><strong>hi</strong> &lt;script&gt;</p>' });
  });
  it('keeps the ids of checklist items whose text is unchanged', () => {
    const f = fieldsFor({ kind: 'checklist', box: 'b1', items: [{ text: 'Eggs', done: true }, { text: 'Bread', done: false }] }, list('c1', 0)) as { items: { id: string; text: string }[] };
    expect(f.items[0].id).toBe('i2');
    expect(f.items[1].id).not.toBe('i1');
    expect(f.items[1].text).toBe('Bread');
  });
  it('fingerprints change when content changes', () => {
    expect(fingerprint(text('a', '<p>1</p>'))).not.toBe(fingerprint(text('a', '<p>2</p>')));
  });
});
