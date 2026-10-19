import type { Arrow, Block, NoteColor } from '../types';
import type { PageRecord, SyncStore } from '../storage/types';

/** Every device builds the built-in templates with these ids, so two devices that each seed them agree and nothing is duplicated. */
export const BUILTIN_IDS = {
  meeting: 'tpl-meeting',
  weekly: 'tpl-weekly',
  project: 'tpl-project',
  todo: 'tpl-todo',
  brainstorm: 'tpl-brainstorm',
  daily: 'tpl-daily',
} as const;

/** Both devices start these at the same version, so they begin in sync; only an edit makes a template differ. */
export const SEED_ETAG = 'seed-1';
const SEEDED_KEY = 'templates.seeded';

type Draft = { type: Block['type']; x: number; y: number; w: number; h: number } & Record<string, unknown>;

function builder(prefix: string) {
  let n = 0;
  const id = () => `${prefix}-${++n}`;
  const blocks: Block[] = [];
  const add = (b: Draft) => {
    const full = { ...b, id: id(), z: blocks.length + 1 } as unknown as Block;
    if (full.frameId === undefined) delete full.frameId;
    blocks.push(full);
    return full.id;
  };
  return {
    blocks,
    id,
    text: (x: number, y: number, w: number, html: string, frameId?: string) => add({ type: 'text', x, y, w, h: 40, html, frameId } as Draft),
    list: (x: number, y: number, w: number, items: string[], frameId?: string) =>
      add({ type: 'checklist', x, y, w, h: 48, items: items.map((text, i) => ({ id: `${prefix}-item-${x}-${y}-${i}`, text, done: false })), frameId } as Draft),
    table: (x: number, y: number, w: number, rows: string[][], frameId?: string) => add({ type: 'table', x, y, w, h: 72, rows, frameId } as Draft),
    sticky: (x: number, y: number, tint: NoteColor, html: string, frameId?: string) =>
      add({ type: 'sticky', x, y, w: 200, h: 200, html, tint, frameId } as Draft),
    frame: (x: number, y: number, w: number, h: number, title: string, color: string, frameId?: string) =>
      add({ type: 'frame', x, y, w, h, title, color, collapsed: false, frameId } as Draft),
  };
}

type Built = { title: string; blocks: Block[]; arrows: Arrow[] };

const arrow = (id: string, from: string, to: string): Arrow => ({ id, from, to, heads: 'one', style: 'solid', z: 1 });

const meeting = (): Built => {
  const b = builder(BUILTIN_IDS.meeting);
  b.text(136, 48, 600, '<h1>Meeting notes</h1><p>Date · Attendees · Goal of the meeting</p>');
  const agenda = b.frame(136, 176, 360, 300, 'Agenda', 'ultra');
  b.list(152, 224, 328, ['Topic one', 'Topic two', 'Topic three'], agenda);
  const notes = b.frame(528, 176, 440, 300, 'Notes', 'slate');
  b.text(544, 224, 408, '<p>Decisions and key points…</p>', notes);
  const actions = b.frame(136, 508, 832, 220, 'Action items', 'ochre');
  b.list(152, 556, 800, ['Who: what, by when'], actions);
  return { title: 'Meeting notes', blocks: b.blocks, arrows: [] };
};

const weekly = (): Built => {
  const b = builder(BUILTIN_IDS.weekly);
  b.text(136, 48, 600, '<h1>Weekly review</h1><p>Week of …</p>');
  const wins = b.frame(136, 176, 300, 300, 'Wins', 'moss');
  b.sticky(152, 224, 'green', '<p>What went well?</p>', wins);
  const misses = b.frame(468, 176, 300, 300, 'What got in the way', 'brick');
  b.sticky(484, 224, 'orange', '<p>What didn’t go to plan?</p>', misses);
  const next = b.frame(800, 176, 360, 300, 'Next week', 'ultra');
  b.list(816, 224, 328, ['Top priority', 'Second priority', 'Something for me'], next);
  b.text(136, 508, 700, '<h2>Reflection</h2><p>One thing to do differently next week…</p>');
  return { title: 'Weekly review', blocks: b.blocks, arrows: [] };
};

const project = (): Built => {
  const b = builder(BUILTIN_IDS.project);
  const goal = b.text(136, 48, 520, '<h1>Project plan</h1><p>Goal: what does done look like?</p>');
  const miles = b.table(136, 208, 640, [['Milestone', 'Owner', 'Due', 'Status'], ['', '', '', ''], ['', '', '', ''], ['', '', '', '']]);
  const tasks = b.frame(136, 400, 400, 280, 'Tasks', 'teal');
  b.list(152, 448, 368, ['First task', 'Second task'], tasks);
  const risks = b.frame(568, 400, 400, 280, 'Risks and open questions', 'brick');
  b.text(584, 448, 368, '<p>What could go wrong?</p>', risks);
  return { title: 'Project plan', blocks: b.blocks, arrows: [arrow(`${BUILTIN_IDS.project}-arrow`, goal, miles)] };
};

const todo = (): Built => {
  const b = builder(BUILTIN_IDS.todo);
  b.text(136, 48, 520, '<h1>To-do list</h1>');
  b.text(136, 128, 300, '<h2>Today</h2>');
  b.list(136, 176, 300, ['', '', ''], undefined);
  b.text(488, 128, 300, '<h2>This week</h2>');
  b.list(488, 176, 300, ['', '', ''], undefined);
  b.text(840, 128, 300, '<h2>Later</h2>');
  b.list(840, 176, 300, ['', ''], undefined);
  return { title: 'To-do list', blocks: b.blocks, arrows: [] };
};

const brainstorm = (): Built => {
  const b = builder(BUILTIN_IDS.brainstorm);
  b.text(136, 48, 600, '<h1>Brainstorm</h1><p>The question we are exploring…</p>');
  const ideas = b.frame(136, 176, 480, 320, 'Ideas', 'ochre');
  b.sticky(152, 224, 'yellow', '<p>An idea</p>', ideas);
  b.sticky(368, 224, 'orange', '<p>Another idea</p>', ideas);
  const questions = b.frame(648, 176, 480, 320, 'Questions', 'plum');
  b.sticky(664, 224, 'purple', '<p>What do we not know yet?</p>', questions);
  b.sticky(880, 224, 'pink', '<p>What if…?</p>', questions);
  const next = b.frame(136, 528, 992, 280, 'Next steps', 'moss');
  b.sticky(152, 568, 'green', '<p>First step</p>', next);
  b.sticky(368, 568, 'blue', '<p>Who can help?</p>', next);
  return { title: 'Brainstorm board', blocks: b.blocks, arrows: [] };
};

const daily = (): Built => {
  const b = builder(BUILTIN_IDS.daily);
  b.text(136, 48, 420, '<h2>Focus</h2><p>The one thing that would make today a good day…</p>');
  b.list(136, 176, 420, ['', '', ''], undefined);
  b.sticky(616, 48, 'yellow', '<p>Win of the day</p>');
  b.text(136, 384, 760, '<h2>Notes</h2><p></p>');
  return { title: 'Daily page', blocks: b.blocks, arrows: [] };
};

/** The six starter templates, as page records ready to be stored (marked as already agreed between devices). */
export function builtinTemplates(now = Date.now()): PageRecord[] {
  const made: [string, Built][] = [
    [BUILTIN_IDS.meeting, meeting()],
    [BUILTIN_IDS.weekly, weekly()],
    [BUILTIN_IDS.project, project()],
    [BUILTIN_IDS.todo, todo()],
    [BUILTIN_IDS.brainstorm, brainstorm()],
    [BUILTIN_IDS.daily, daily()],
  ];
  return made.map(([id, t]) => ({
    id,
    etag: SEED_ETAG,
    deleted: false,
    title: t.title,
    groupId: null,
    tags: [],
    blocks: t.blocks,
    arrows: t.arrows,
    drawing: null,
    color: null,
    kind: 'template',
    dailyDate: null,
    created: now,
    updated: now,
  }));
}

interface Seedable {
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string | null): Promise<void>;
  sync: Pick<SyncStore, 'listMeta' | 'applyRemote'>;
}

/**
 * Adds the starter templates once. A template whose id is already known, even as a deleted one, is never added again,
 * so deleting a starter really removes it, and a device that syncs in a starter another device seeded doesn't get a second copy.
 */
export async function seedBuiltinTemplates(storage: Seedable): Promise<number> {
  if ((await storage.getSetting(SEEDED_KEY)) !== null) return 0;
  const known = new Set((await storage.sync.listMeta('page')).map((m) => m.id));
  let added = 0;
  for (const rec of builtinTemplates()) {
    if (known.has(rec.id)) continue;
    await storage.sync.applyRemote('page', rec);
    added++;
  }
  await storage.setSetting(SEEDED_KEY, String(Date.now()));
  return added;
}
