import { describe, expect, it } from 'vitest';
import { clampSize, fitLogicalSize, isWidgetId, needsFit, newWidget, parseIndex, parseWidget, widgetIdFor, widgetQuery, withGeometry, WIDGET_HEADER, WIDGET_MAX, WIDGET_MIN } from '../src/lib/widgets';
import { parseRoute } from '../src/lib/routeParse';
import { getWidget, listWidgets, removeWidget, saveWidget, type SettingsStore } from '../src/widgets/registry';

const memory = (): SettingsStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getSetting: async (k) => data.get(k) ?? null,
    setSetting: async (k, v) => void (v === null ? data.delete(k) : data.set(k, v)),
  };
};

describe('widget specs', () => {
  it('sizes a widget like its box plus the title strip, within limits', () => {
    const w = newWidget('p1', { id: 'b1', w: 300, h: 200 });
    expect(w).toMatchObject({ id: 'w-p1-b1', pageId: 'p1', blockId: 'b1', w: 300, h: 200 + WIDGET_HEADER, bottom: true, x: null });
    expect(newWidget('p1', { id: 'b2', w: 5, h: 5 })).toMatchObject({ w: WIDGET_MIN.w, h: WIDGET_MIN.h });
    expect(newWidget('p1', { id: 'b3', w: 99999, h: 99999 })).toMatchObject({ w: WIDGET_MAX.w, h: WIDGET_MAX.h });
    expect(newWidget('p1', null)).toMatchObject({ id: 'w-p1-page', blockId: null });
    expect(clampSize(1, 1)).toEqual({ w: WIDGET_MIN.w, h: WIDGET_MIN.h });
  });

  it('round-trips through storage text', () => {
    const w = { ...newWidget('p1', { id: 'b1', w: 300, h: 200 }), x: 40, y: 60, bottom: false };
    expect(parseWidget(JSON.stringify(w))).toEqual(w);
  });

  it('refuses damaged or hostile entries', () => {
    const ok = newWidget('p1', { id: 'b1', w: 300, h: 200 });
    const bad = [
      null,
      '',
      'not json',
      '[]',
      JSON.stringify({ ...ok, pageId: '../x', id: widgetIdFor('../x', 'b1') }),
      JSON.stringify({ ...ok, blockId: 'a/b' }),
      JSON.stringify({ ...ok, id: 'w-other-b1' }), // id doesn't match its page and box
      JSON.stringify({ ...ok, id: 'main' }),
    ];
    for (const raw of bad) expect(parseWidget(raw as string | null), String(raw)).toBeNull();
  });

  it('cleans numbers rather than trusting them', () => {
    const ok = newWidget('p1', null);
    const w = parseWidget(JSON.stringify({ ...ok, x: 'far', y: null, w: 99999, h: -4 }))!;
    expect(w.x).toBeNull();
    expect(w.w).toBe(WIDGET_MAX.w);
    expect(w.h).toBe(WIDGET_MIN.h);
  });

  it('only accepts window labels of the right shape', () => {
    expect(isWidgetId('w-p1-b1')).toBe(true);
    for (const bad of ['main', 'w-', 'w-a b', 'w-../x', 'x-p1', 'w-' + 'a'.repeat(161), 5, null]) expect(isWidgetId(bad), String(bad)).toBe(false);
  });

  it('reads the list of widget ids safely', () => {
    expect(parseIndex('["w-a-b","w-a-b","main","w-c-page"]')).toEqual(['w-a-b', 'w-c-page']);
    expect(parseIndex('{"a":1}')).toEqual([]);
    expect(parseIndex('nope')).toEqual([]);
    expect(parseIndex(null)).toEqual([]);
  });
});

describe('remembering where a widget was left', () => {
  it('writes the window geometry in, keeping everything else', () => {
    const w = { ...newWidget('p1', null), bottom: false };
    expect(withGeometry(w, { x: 10.4, y: -20.6, w: 600.2, h: 300 })).toMatchObject({ x: 10, y: -21, w: 600, h: 300, bottom: false, id: w.id });
    expect(withGeometry(w, { x: NaN, y: 5, w: 5, h: 5 })).toMatchObject({ x: null, y: 5, w: WIDGET_MIN.w, h: WIDGET_MIN.h });
  });
});

describe('fitting a widget window to its page', () => {
  it('grows the window by the missing pixels, scaled by the pixel ratio', () => {
    // wanted 240x230 CSS px, the page has 192x213; the window is 240x267 logical; the page's ratio is 1.25 and the window's 1
    expect(fitLogicalSize({ w: 240, h: 230 }, { w: 192, h: 213 }, { w: 240, h: 267 }, 1.25)).toEqual({ w: 300, h: 288.25 });
    expect(fitLogicalSize({ w: 240, h: 230 }, { w: 240, h: 230 }, { w: 240, h: 230 }, 1)).toEqual({ w: 240, h: 230 });
  });
  it('shrinks too, and ignores a nonsense ratio', () => {
    expect(fitLogicalSize({ w: 200, h: 200 }, { w: 260, h: 260 }, { w: 300, h: 300 }, 1)).toEqual({ w: 240, h: 240 });
    expect(fitLogicalSize({ w: 200, h: 200 }, { w: 100, h: 100 }, { w: 100, h: 100 }, NaN)).toEqual({ w: 200, h: 200 });
  });
  it('only bothers when the difference is noticeable', () => {
    expect(needsFit({ w: 240, h: 230 }, { w: 238, h: 233 })).toBe(false);
    expect(needsFit({ w: 240, h: 230 }, { w: 192, h: 230 })).toBe(true);
  });
});

describe('the widget window address', () => {
  it('is built and read back', () => {
    expect(widgetQuery({ pageId: 'p1', blockId: 'b1' })).toBe('?widget=p1&block=b1');
    expect(widgetQuery({ pageId: 'p1', blockId: null })).toBe('?widget=p1');
    expect(parseRoute('?widget=p1&block=b1', '')).toEqual({ name: 'widget', pageId: 'p1', blockId: 'b1' });
    expect(parseRoute('?widget=p1', '')).toEqual({ name: 'widget', pageId: 'p1', blockId: null });
  });

  it('falls back to the normal routes, and ignores unsafe ids', () => {
    expect(parseRoute('', '#/page/abc')).toEqual({ name: 'page', id: 'abc' });
    expect(parseRoute('', '')).toEqual({ name: 'library' });
    expect(parseRoute('?widget=../x', '')).toEqual({ name: 'library' });
    expect(parseRoute('?widget=p1&block=a%2Fb', '')).toEqual({ name: 'library' });
  });
});

describe('the widget registry', () => {
  it('remembers, lists, updates and removes widgets', async () => {
    const s = memory();
    const a = newWidget('p1', { id: 'b1', w: 300, h: 200 });
    const b = newWidget('p2', null);
    await saveWidget(s, a);
    await saveWidget(s, b);
    expect((await listWidgets(s)).map((w) => w.id)).toEqual([a.id, b.id]);
    await saveWidget(s, { ...a, x: 10, y: 20 });
    expect((await listWidgets(s)).length).toBe(2);
    expect((await getWidget(s, a.id))!.x).toBe(10);
    await removeWidget(s, a.id);
    expect((await listWidgets(s)).map((w) => w.id)).toEqual([b.id]);
    expect(s.data.has(`widget.${a.id}`)).toBe(false);
  });

  it('skips entries that are damaged', async () => {
    const s = memory();
    await saveWidget(s, newWidget('p1', { id: 'b1', w: 300, h: 200 }));
    await saveWidget(s, newWidget('p2', null));
    s.data.set('widgets.index', JSON.stringify(['w-p1-b1', 'w-p2-page', 'w-broken-x']));
    expect((await listWidgets(s)).length).toBe(2);
    s.data.set('widget.w-p2-page', '{"nonsense":true}');
    expect((await listWidgets(s)).map((w) => w.id)).toEqual(['w-p1-b1']);
  });

  it('never reads a widget by an id that is not a widget id', async () => {
    const s = memory();
    s.data.set('widget.main', JSON.stringify(newWidget('p1', null)));
    expect(await getWidget(s, 'main')).toBeNull();
  });
});
