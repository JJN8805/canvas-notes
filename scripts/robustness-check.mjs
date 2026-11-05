// Damaged data must never blank the app: each kind of malformed page is put into storage on its own, and the library, the
// page, the Journal and the switcher must still open. Run with the dev server up:  node scripts/robustness-check.mjs [caseName,caseName]
// (exits 1 if any case breaks something)
import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const root = join(homedir(), '.cache', 'ms-playwright');
let exe; for (const d of readdirSync(root).filter(n=>/^chromium-\d+$/.test(n)).sort().reverse()) for (const s of ['chrome-linux64/chrome','chrome-linux/chrome']) if (!exe && existsSync(join(root,d,s))) exe = join(root,d,s);
const b = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const blk = (o) => ({ id: 'b' + Math.random().toString(36).slice(2, 7), x: 10, y: 10, w: 200, h: 80, z: 1, ...o });
const base = (id, extra) => ({ id, title: 'T ' + id, groupId: null, tags: [], blocks: [], arrows: [], created: 1, updated: 1, rev: 1, etag: 'e', synced: 'e', deleted: 0, ...extra });
const cases = {
  textNoHtml: { blocks: [blk({ type: 'text' })] },
  textNullHtml: { blocks: [blk({ type: 'text', html: null })] },
  checklistNoItems: { blocks: [blk({ type: 'checklist' })] },
  checklistNullItem: { blocks: [blk({ type: 'checklist', items: [null, { id: 'x' }] })] },
  tableNoRows: { blocks: [blk({ type: 'table' })] },
  tableBadRows: { blocks: [blk({ type: 'table', rows: ['a', null, [1, 2]] })] },
  codeNoCode: { blocks: [blk({ type: 'code' })] },
  imageNoId: { blocks: [blk({ type: 'image' })] },
  imageMissing: { blocks: [blk({ type: 'image', imageId: 'nope', aspect: 0 })] },
  unknownType: { blocks: [blk({ type: 'hologram' })] },
  noGeometry: { blocks: [{ id: 'g1', type: 'text', html: '<p>hi</p>' }] },
  nanGeometry: { blocks: [blk({ type: 'text', html: '<p>hi</p>', x: NaN, w: 'wide' })] },
  stickyNoHtml: { blocks: [blk({ type: 'sticky' })] },
  frameNoTitle: { blocks: [blk({ type: 'frame' })] },
  audioNoFile: { blocks: [blk({ type: 'audio' })] },
  pdfNoFile: { blocks: [blk({ type: 'pdf' })] },
  cardMissing: { blocks: [blk({ type: 'card', cardId: 'ghost' })] },
  cardNoId: { blocks: [blk({ type: 'card' })] },
  nullBlock: { blocks: [null, 5] },
  noBlocks: { blocks: undefined },
  noArrows: { arrows: undefined },
  badArrows: { blocks: [blk({ type: 'text', html: '<p>x</p>', id: 'a1' })], arrows: [{ id: 'ar', from: 'a1', to: 'zzz' }, null] },
  nullTitle: { title: null },
  noTags: { tags: undefined },
  nullTags: { tags: [null, 3] },
  badDaily: { dailyDate: '2026-13-45' },
  sheetGarbage: { sheet: 'wide' },
  sheetTiny: { sheet: { x: 0, y: 0, w: 3, h: 3 } },
  sheetNaN: { sheet: { x: null, y: 0, w: 900, h: 900 } },
  sheetSmallerThanContent: { sheet: { x: 0, y: 0, w: 400, h: 400 }, blocks: [{ id: 'far', type: 'text', x: 3000, y: 3000, w: 200, h: 40, z: 1, html: '<p>far</p>' }] },
  dailyOk: { dailyDate: '2026-11-03', blocks: [blk({ type: 'text', html: '<p>day</p>' })] },
  trackedBad: { blocks: [blk({ type: 'checklist', items: [{ id: 'i', text: 'a', done: false }], track: { start: 'x', day: 'y' } })] },
  attendanceBad: { blocks: [blk({ id: 'att-summary', type: 'table', rows: [['a']], attendance: { pageId: 'nope', blockId: 'zz' } })] },
  drawingBad: { drawing: { scene: '{', preview: '<svg', x: 'a', y: 0, w: 5, h: 5 } },
  drawingNull: { drawing: { scene: null, preview: null } },
  hugeCoords: { blocks: [blk({ type: 'text', html: '<p>far</p>', x: 1e12, y: -1e12 })] },
  frameLoop: { blocks: [blk({ id: 'f1', type: 'frame', title: 'f', frameId: 'f2' }), blk({ id: 'f2', type: 'frame', title: 'g', frameId: 'f1' })] },
};
const ids = process.argv[2] ? process.argv[2].split(',') : Object.keys(cases);
const bad = [];
for (const k of ids) {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 160)));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text().replace(/\s+/g, ' ').slice(0, 220)));
  await p.goto('http://localhost:1420'); await p.waitForSelector('.sidebar'); await p.waitForTimeout(600);
  await p.evaluate(async ({ k, extra, base }) => {
    const dbs = await indexedDB.databases();
    await new Promise((res, rej) => {
      const o = indexedDB.open(dbs[0].name);
      o.onsuccess = () => { const db = o.result; const tx = db.transaction('pages', 'readwrite'); tx.objectStore('pages').put({ ...base, id: 'fz-' + k, title: 'FZ ' + k, ...extra }); tx.oncomplete = res; tx.onerror = () => rej(tx.error); };
    });
  }, { k, extra: cases[k], base: base('x', {}) });
  await p.reload(); await p.waitForTimeout(1200);
  const lib = { sidebar: await p.locator('.sidebar').count(), boundary: await p.locator('.load-error').count() };
  const libErr = errs.filter((e) => /PAGEERROR|Cannot|not a function|undefined|null/i.test(e)).slice(0, 1);
  errs.length = 0;
  await p.evaluate((id) => { location.hash = '#/page/fz-' + id; }, k);
  await p.waitForTimeout(900);
  const pg = { editor: await p.locator('.ed-head').count(), boundary: await p.locator('.load-error').count() };
  const pgErr = errs.filter((e) => /PAGEERROR|Cannot|not a function|undefined|null/i.test(e)).slice(0, 1);
  // back to the library and open the page's card and the journal, then exports/search
  await p.evaluate(() => { location.hash = ''; }); await p.waitForTimeout(500);
  await p.click('.sidebar .nav-item:has-text("Journal")').catch(() => {}); await p.waitForTimeout(900);
  const jr = { journal: await p.locator('.journal, .book').count(), boundary: await p.locator('.load-error').count() };
  await p.keyboard.press('Control+k').catch(() => {}); await p.keyboard.type('FZ').catch(() => {}); await p.waitForTimeout(400);
  const fail = lib.boundary || !lib.sidebar || pg.boundary || !pg.editor || jr.boundary || !jr.journal;
  if (fail) bad.push(k);
  console.log((fail ? 'FAIL ' : 'ok   ') + k.padEnd(17), 'lib', JSON.stringify(lib), 'page', JSON.stringify(pg), 'journal', JSON.stringify(jr), [...libErr, ...pgErr].map((e) => e.slice(0, 120)).join(' | '));
  await ctx.close();
}
console.log('\nbroken:', bad.join(', ') || 'none');
await b.close();
process.exit(bad.length ? 1 : 0);
