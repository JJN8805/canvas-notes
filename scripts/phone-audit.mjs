// A visual audit of the phone layout: visits every screen in a phone-sized touch window (360 x 780, like the real phone), takes a screenshot of each,
// and runs detectors for the usual problems: sideways scrolling, controls past the screen edge, clipped text on buttons and fields, controls on top of
// each other, and touch targets that are too small. Then read the screenshots.
// Run with the dev server up (`npm run dev`):  node scripts/phone-audit.mjs [dark]
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const DARK = process.argv.includes('dark');
const OUT = join(tmpdir(), (DARK ? 'canvas-phone-audit-dark' : 'canvas-phone-audit') + (process.env.WIDTH ? '-' + process.env.WIDTH : ''));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const root = join(homedir(), '.cache', 'ms-playwright');
  for (const d of readdirSync(root).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse())
    for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome']) if (existsSync(join(root, d, sub))) return join(root, d, sub);
}
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: Number(process.env.WIDTH ?? 360), height: Number(process.env.HEIGHT ?? 780) }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: DARK ? 'dark' : 'light' });
let page = await ctx.newPage();
const errors = [];
const watch = (pg) => { pg.on('console', (m) => (m.type() === 'error' && !/esm\.sh|font/i.test(m.text()) ? errors.push(m.text().slice(0, 200)) : 0)); pg.on('pageerror', (e) => errors.push(`exception: ${e.message}`)); };
watch(page);

/* ---------------- sample data ---------------- */
await page.goto(URL);
await page.waitForSelector('.phone-tabs');
await page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('canvas-notes'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const note = (id, html, x, y, extra = {}) => ({ id, type: 'note', style: 'text', x, y, w: 240, h: 70, z: 1, html, ...extra });
  const mk = (id, title, extra = {}) => ({ id, etag: 'e' + id, synced: null, deleted: false, title, groupId: null, tags: [], blocks: [], arrows: [], drawing: null, color: null, kind: 'page', dailyDate: null, sheet: null, created: now, updated: now - Math.random() * 1e7, rev: 1, ...extra });
  const body = (id, html) => ({ id, type: 'note', style: 'text', x: 0, y: 0, w: 320, h: 120, z: 1, html });
  const rich = [
    note('n1', '<p>Idea one</p>', 0, 0, { style: 'sticky', tint: 'yellow', w: 200, h: 160, z: 1 }),
    note('n2', '<p>Idea two</p>', 40, 30, { style: 'sticky', tint: 'blue', w: 200, h: 160, z: 2, header: 'With a header' }),
    note('n3', '<h1>Background reading</h1><p>Papers and links that go on for a while so the box has to wrap its text across several lines.</p><ul><li>one</li><li>two</li></ul>', 320, 0, { z: 3, header: 'Reading' }),
    note('n4', '<p>Pinned note</p>', 320, 200, { z: 4, locked: true }),
    { id: 'c1', type: 'checklist', x: 0, y: 300, w: 260, h: 140, z: 5, items: [{ id: 'i1', text: 'Buy milk', done: true }, { id: 'i2', text: 'Call the dentist about the appointment next week', done: false }] },
    { id: 't1', type: 'table', x: 300, y: 300, w: 300, h: 100, z: 6, rows: [['Day', 'Plan', 'Cost'], ['Mon', 'Study', '0'], ['Tue', 'Gym', '10']] },
    note('code1', '', 0, 480, { style: 'code', code: 'const x = 1;\nconsole.log(x);', w: 300, h: 90 }),
    { id: 'f1', type: 'frame', x: -30, y: -50, w: 660, h: 340, z: 0, title: 'Project', color: 'slate', collapsed: false },
  ];
  const long = 'A very long page title that keeps going to test how cards, headers and menus cope with it';
  const pages = [
    mk('sp', 'Plan', { blocks: rich, tags: ['project', 'urgent'], groupId: 'g1', icon: '📌' }),
    mk('lp', long, { tags: ['a-very-long-tag-name-here'] }),
    mk('lec', 'Lecture notes', { tags: ['maths', 'exam'], groupId: 'g2', blocks: [note('l1', '<h2>Calculus</h2><p>Limits and derivatives</p>', 0, 0)] }),
    mk('day', 'Today', { dailyDate: today, blocks: [note('d1', '<p>Wrote something today</p>', 0, 0), { id: 'dc', type: 'checklist', x: 0, y: 100, w: 260, h: 100, z: 2, items: [{ id: 'x1', text: 'Review notes', done: false }] }] }),
    mk('arch', 'Old project', { archived: true }),
    mk('trash', 'Deleted page', { deleted: true, blocks: [note('tt', '<p>gone</p>', 0, 0)] }),
    mk('stu', 'Thesis outline', { workspace: 'wstudent', blocks: [note('s1', '<p>Intro</p>', 0, 0)] }),
    mk('card1', 'Eiffel Tower', { kind: 'card', groupId: 'cs1', blocks: [body('b1', '<p>Paris, France. Built in 1889.</p>')] }),
    mk('card2', 'Tokyo', { kind: 'card', groupId: 'cs2', blocks: [body('b2', '<p>Capital of Japan</p>')] }),
    mk('card3', 'An unfiled card with a really quite long label to wrap', { kind: 'card', blocks: [body('b3', '<p>Some details about this card that run on.</p>')] }),
  ];
  const grp = (id, name, extra = {}) => ({ id, name, color: 'teal', position: 0, parentId: null, etag: 'e' + id, synced: null, deleted: false, ...extra });
  const tx = db.transaction(['pages', 'groups'], 'readwrite');
  for (const p of pages) tx.objectStore('pages').put(p);
  tx.objectStore('groups').put(grp('g1', 'Courses', { color: 'plum' }));
  tx.objectStore('groups').put(grp('g2', 'Maths', { parentId: 'g1', color: 'ochre' }));
  tx.objectStore('groups').put(grp('cf1', 'Trips', { scope: 'cards', color: 'moss' }));
  tx.objectStore('groups').put(grp('cs1', 'Europe', { scope: 'cards', parentId: 'cf1', color: 'ultra', description: 'Places to see in Europe' }));
  tx.objectStore('groups').put(grp('cs2', 'Asia', { scope: 'cards', parentId: 'cf1', color: 'brick' }));
  tx.objectStore('groups').put(grp('wstudent', 'Student', { scope: 'workspaces', color: 'teal' }));
  await new Promise((res) => (tx.oncomplete = res));
  db.close();
});
await page.reload();
await page.waitForSelector('.phone-tabs');
await page.waitForTimeout(900);

/* ---------------- detectors ---------------- */
const report = [];
async function audit(name, { shot = true } = {}) {
  await page.waitForTimeout(350);
  const issues = await page.evaluate(() => {
    const out = [];
    const W = innerWidth, H = innerHeight;
    // Only what the person can actually touch: not hidden, and not covered by a dialog, menu or the bars (checked at the centre).
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      const cs = getComputedStyle(e);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return null;
      const cx = Math.min(W - 1, Math.max(1, r.left + r.width / 2)), cy = Math.min(H - 1, Math.max(1, r.top + r.height / 2));
      if (r.bottom < 0 || r.top > H) return null;
      const top = document.elementFromPoint(cx, cy);
      if (!top || !(top === e || e.contains(top) || top.contains(e))) return null;
      return r;
    };
    const label = (e) => `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 24) ? ` “${(e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24)}”` : ''}`;
    // the canvas world is meant to be bigger than the screen
    const inWorld = (e) => !!e.closest('.world, .canvas, canvas, .minimap, .scene3d, .tree3d-stage, .ex-wrap, .excalidraw, .thumb, .thumbnail, .cthumb');
    if (document.documentElement.scrollWidth > W + 1) out.push(`SIDEWAYS: the page scrolls sideways (${document.documentElement.scrollWidth} > ${W})`);
    const all = [...document.querySelectorAll('body *')];
    for (const e of all) {
      if (inWorld(e)) continue;
      const r = vis(e);
      if (!r) continue;
      const scroller = e.closest('[style*="overflow"], .tabs-scroll');
      const interactive = e.matches('button, a, input, select, textarea, [role=button], [role=tab], .menu-item');
      if (interactive && (r.right > W + 1 || r.left < -1)) {
        // inside a scroller that is meant to scroll sideways is fine
        let p = e.parentElement, ok = false;
        while (p) { const cs = getComputedStyle(p); if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && p.scrollWidth > p.clientWidth) { ok = true; break; } p = p.parentElement; }
        if (!ok) out.push(`OFFSCREEN: ${label(e)} spans ${Math.round(r.left)}..${Math.round(r.right)}`);
      }
      if (interactive && (e.tagName === 'BUTTON' || e.tagName === 'A' || e.tagName === 'SELECT' || e.tagName === 'INPUT' || e.getAttribute('role') === 'button')) {
        const cs = getComputedStyle(e);
        if (e.tagName === 'SELECT') {
          const sel = e.options[e.selectedIndex];
          const c = document.createElement('canvas').getContext('2d');
          c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
          const need = c.measureText(sel ? sel.textContent : '').width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 22;
          if (need > r.width + 1) out.push(`CLIPPED select: ${label(e)} needs ${Math.round(need)}px, has ${Math.round(r.width)}px`);
        } else if (e.tagName !== 'INPUT' && (cs.overflow === 'hidden' || cs.overflowX === 'hidden') && e.scrollWidth > e.clientWidth + 2 && cs.textOverflow !== 'ellipsis') {
          out.push(`CLIPPED text: ${label(e)} (${e.scrollWidth} > ${e.clientWidth})`);
        }
        const small = r.width < 36 || r.height < 36;
        if (small && !e.closest('.minimap, .zoom, .ci-grip') && r.width > 0) out.push(`SMALL target: ${label(e)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      // text that overflows its box without ellipsis (non-interactive labels)
      if (!interactive && e.children.length === 0 && e.textContent && e.textContent.trim()) {
        const cs = getComputedStyle(e);
        if ((cs.overflowX === 'hidden') && cs.textOverflow !== 'ellipsis' && e.scrollWidth > e.clientWidth + 2 && cs.whiteSpace !== 'normal') out.push(`CUT label: ${label(e)} (${e.scrollWidth} > ${e.clientWidth})`);
      }
    }
    // controls on top of each other (not nested; not both inside the world)
    const ctl = all.filter((e) => !inWorld(e) && e.matches('button, a, input, select, textarea, [role=button]') && vis(e));
    for (let i = 0; i < ctl.length; i++) {
      for (let j = i + 1; j < ctl.length; j++) {
        const a = ctl[i], b = ctl[j];
        if (a.contains(b) || b.contains(a)) continue;
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (w > 4 && h > 4) {
          const frac = (w * h) / Math.min(ra.width * ra.height, rb.width * rb.height);
          if (frac > 0.25) out.push(`OVERLAP: ${label(a)} over ${label(b)} (${Math.round(frac * 100)}%)`);
        }
      }
    }
    // the bottom tabs / dock covering the last interactive thing at the end of a scrolled list
    return [...new Set(out)].slice(0, 25);
  });
  if (shot) {
    const file = join(OUT, `${String(report.length + 1).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`);
    await page.screenshot({ path: file, timeout: 45000 }).catch(async () => { await page.waitForTimeout(1500); await page.screenshot({ path: file, timeout: 45000 }).catch(() => {}); });
  }
  report.push({ name, issues });
  console.log(`${issues.length ? '!!' : 'ok'}  ${name}${issues.length ? '\n      ' + issues.join('\n      ') : ''}`);
}
const fresh = async (hash) => { await page.close().catch(() => {}); page = await ctx.newPage(); watch(page); await page.goto(URL + '/' + hash); await page.waitForSelector(hash.startsWith('#/page') ? '.world' : '.phone-tabs', { timeout: 20000 }).catch(async (e) => { console.log('fresh failed at', page.url(), (await page.locator('body').innerText()).slice(0, 200).replace(/\n/g, ' | ')); throw e; }); await page.waitForTimeout(700); };
const tap = (sel) => page.locator(sel).first().tap();
const back = async () => { await page.evaluate(() => { location.hash = '#/'; }); await page.waitForSelector('.phone-tabs'); await page.waitForTimeout(300); };
const closeAny = async () => { await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(150); };
const tab = (label) => page.locator(`.phone-tabs button:has-text("${label}")`).first().tap();
const more = async (entry) => { await tab('More'); await page.waitForSelector('.sheet, .more-sheet, [role=dialog]'); await page.locator(`.nav-item:has-text("${entry}")`).first().tap(); await page.waitForTimeout(500); };

main: {
if (process.env.ONLY === 'extra') break main;
/* ---------------- the library ---------------- */
await audit('library: pages');
await page.evaluate(() => window.scrollTo(0, 99999)); await audit('library: pages scrolled to the end');
await page.evaluate(() => window.scrollTo(0, 0));
await tab('Journal'); await audit('library: journal');
await tab('Cards'); await audit('library: cards (all cards)');
await page.locator('.cf-show').first().tap().catch(() => {});
await audit('library: cards (folders shown)');
await page.locator('.cf-go', { hasText: 'Trips' }).first().tap().catch(() => {});
await audit('library: cards (a folder opened)');
await page.locator('.section-act[aria-label^="Menu for"]').first().tap().catch(() => {});
await audit('library: cards (section menu)');
await closeAny();
await tab('Search'); await audit('search: quick switcher');
await page.fill('.palette input', 'Plan'); await audit('search: typed a word');
await closeAny();
await tab('More'); await audit('more sheet');
for (const entry of ['Groups', 'Tags', 'Templates', 'Archive', 'Trash']) {
  await page.locator(`.nav-item:has-text("${entry}")`).first().tap().catch(async () => { await tab('More'); await page.locator(`.nav-item:has-text("${entry}")`).first().tap(); });
  await audit(`library: ${entry.toLowerCase()}`);
  await tab('More');
}
await closeAny();
await tab('Pages');

/* ---------------- selecting ---------------- */
await page.locator('button:has-text("Select")').first().tap().catch(() => {});
await audit('library: picking pages');
await page.locator('.card').first().tap().catch(() => {});
await audit('library: one page picked');
await page.locator('.select-bar button:has-text("Move to")').first().tap().catch(() => {});
await audit('library: pick bar move menu');
await closeAny();
await page.locator('.select-bar button:has-text("Cancel")').first().tap().catch(() => {});

/* ---------------- workspaces ---------------- */
await page.locator('.ws-toolbar').first().tap().catch(() => {});
await audit('workspace menu');
await closeAny();
await page.locator('.ws-toolbar').first().tap().catch(() => {});
await page.locator('.menu-item:has-text("Today in every workspace")').first().tap().catch(() => {});
await audit('today in every workspace');
await closeAny();
await page.locator('.ws-toolbar').first().tap().catch(() => {});
await page.locator('.menu-item:has-text("Find in every workspace")').first().tap().catch(() => {});
await page.fill('[aria-label="Search every workspace"]', 'plan').catch(() => {});
await audit('find in every workspace');
await closeAny();
await page.locator('.ws-toolbar').first().tap().catch(() => {});
await page.locator('.menu-item:has-text("New workspace")').first().tap().catch(() => {});
await audit('new workspace dialog');
await closeAny(); await closeAny();

/* ---------------- new page / settings ---------------- */
await page.locator('.fab, .new-fab, button[aria-label="New page"]').first().tap().catch(() => {});
await page.waitForTimeout(500);
await audit('new page: choose a template');
await closeAny(); await back();
await tab('More'); await page.locator('.side-settings').first().tap();
await page.waitForSelector('.set-tabs');
await audit('settings');
const tabs = await page.locator('.set-tab').allInnerTexts();
for (const t of tabs) {
  await page.locator('.set-tab', { hasText: t.trim() }).first().tap().catch(() => {});
  await audit(`settings: ${t.trim()}`);
}
await closeAny(); await back();

/* ---------------- a card ---------------- */
await tab('Cards');
await page.locator('.cf-card, .card-tile, .ctile').first().tap().catch(() => {});
await page.waitForTimeout(500);
await audit('card detail');
await closeAny();

/* ---------------- the page editor ---------------- */
await back();
await page.evaluate(() => { location.hash = '#/page/sp'; });
await page.waitForSelector('.world', { timeout: 8000 });
await page.waitForTimeout(900);
await audit('page: opened');
await page.locator('.ed-more').tap();
await audit('page: header more');
await page.locator('.ed-more').tap();
const box = await page.locator('.world .block.b-sticky').first().boundingBox();
await page.touchscreen.tap(box.x + 20, box.y + 6);
await page.waitForTimeout(500);
await audit('page: a box selected (dock)');
await page.locator('.touch-dock .bar button').first().tap().catch(() => {});
await audit('page: dock first button');
await closeAny();
await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(600);
await audit('page: typing (format bar)');
await page.locator('.fmt button[aria-label^="Insert"]').first().tap().catch(() => {});
await audit('page: insert menu');
await closeAny();
await page.touchscreen.tap(10, 700); await page.waitForTimeout(300);
// add menu / tools
await audit('page: tools');
await page.locator('.tools button:has-text("Note")').first().tap().catch(() => {});
await audit('page: after adding a note');
for (const cls of ['.ed-history', '.ed-outline', '.ed-export', '.ed-size', '.ed-template', '.ed-ws', '.ed-space']) {
  await fresh('#/page/sp');
  await page.locator('.ed-more').tap();
  await page.locator(`.ed-head.more ${cls}`).first().tap().catch(() => {});
  await audit(`page: ${cls.slice(4)}`);
  await closeAny(); await closeAny();
}

/* ---------------- more of the page ---------------- */
await fresh('#/page/sp');
// select a box without typing: tap its border/grab band, then the dock shows the box's own actions
const stk = await page.locator('.world .block.b-sticky').nth(1).boundingBox();
await page.touchscreen.tap(stk.x + stk.width - 4, stk.y + 4);
await page.waitForTimeout(500);
await audit('page: dock with the box actions');
for (const label of ['Color', 'Layer', 'Links', 'Note style']) {
  await page.locator(`.touch-dock .bar button[aria-label="${label}"]`).first().tap().catch(() => {});
  await audit(`page: dock ${label}`);
  await closeAny(); await closeAny();
}
await page.locator('.world .block.b-frame .frame-head').first().tap().catch(() => {});
await audit('page: a frame selected');
await page.touchscreen.tap(10, 700); await page.waitForTimeout(200);
await page.locator('.zoom .val').first().tap().catch(() => {});
await audit('page: zoom value tapped');
await closeAny();
// graph and outline from the palette
await page.locator('.ed-more').tap();
await page.locator('.ed-head.more .ed-phoneonly:has-text("Commands")').first().tap().catch(() => {});
await audit('page: command list');
await page.fill('.palette input', 'graph').catch(() => {});
await page.keyboard.press('Enter').catch(() => {});
await page.waitForTimeout(1200);
await audit('graph view');
await closeAny(); await closeAny();

/* ---------------- journal, groups, workspace screens ---------------- */
await back();
await tab('Journal');
await page.locator('button[aria-label="Previous day"]').first().tap().catch(() => {});
await audit('journal: a day with no page');
await page.locator('.journal-bar button:has-text("Week")').first().tap().catch(() => {});
await audit('journal: review the week');
await closeAny();
await page.locator('.journal-bar button:has-text("Contents")').first().tap().catch(() => {});
await audit('journal: contents');
await page.locator('.journal-bar button:has-text("Contents")').first().tap().catch(() => {});
await page.locator('.journal-bar button:has-text("Attendance")').first().tap().catch(() => {});
await audit('journal: attendance');
await tab('More');
await page.locator('.nav-item:has-text("Groups")').first().tap();
await page.waitForTimeout(400);
await page.locator('.bcard, .gcard, .browse-card').first().tap().catch(() => {});
await audit('groups: a group opened');
await tab('More');
await page.locator('.nav-item:has-text("Workspace")').first().tap().catch(() => {});
await audit('the Workspace screen');
await tab('More');
await page.locator('.nav-item:has-text("Tags")').first().tap().catch(() => {});
await page.locator('.tag-card, .tagcard, .tag-row').first().tap().catch(() => {});
await audit('tags: a tag opened');
await tab('More');
await page.locator('.nav-item:has-text("Archive")').first().tap().catch(() => {});
await audit('archive');
await tab('More');
await page.locator('.nav-item:has-text("Trash")').first().tap().catch(() => {});
await audit('trash');
await tab('Pages');
await page.locator('.card:has-text("Lecture notes") [aria-label^="Options for"]').first().tap().catch(() => {});
await audit('a page card menu');
await closeAny();

}
/* ---------------- sync, documents, spreadsheets, slides, drawing, empty states ---------------- */
await fresh('#/');
const setSync = (patch) => page.evaluate(async (p) => { const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\/src\/sync\/controller\.ts/.test(n)) ?? '/src/sync/controller.ts'; const m = await import(/* @vite-ignore */ url); m.useSync.setState(p); }, patch);
await page.waitForTimeout(1500);
await page.locator('.sync-btn').first().tap().catch(() => {});
await page.waitForTimeout(500);
for (let i = 0; i < 6 && !(await page.locator('#sync-link').count()); i++) { await setSync({ platform: 'mobile', panelOpen: true, connected: false, serverOn: false }); await page.waitForTimeout(500); }
await audit('sync: the phone panel (not connected)');
await page.fill('#sync-link', 'canvasnotes://pair?a=10.0.0.5&c=ABCD-EFGH-JKLM-NPQR-STUV').catch(() => {});
await audit('sync: a pairing link pasted');
await setSync({ connected: true, lastSync: Date.now(), status: 'idle' });
await audit('sync: connected');
await setSync({ panelOpen: false });
await fresh('#/');
await more('Workspace');
for (const [name, label] of [['a document', 'Blank document'], ['a spreadsheet', 'Blank spreadsheet'], ['a presentation', 'Blank presentation']]) {
  await page.locator(`button:has-text("${label}")`).first().tap().catch(() => {});
  await page.waitForTimeout(900);
  await audit(`workspace: ${name}`);
  await back();
  await more('Workspace');
}
await fresh('#/page/sp');
await page.locator('.tools button:has-text("Draw")').first().tap().catch(() => {});
await page.waitForTimeout(1500);
await audit('drawing mode');
await closeAny();
// empty library and empty cards (a new install)
await fresh('#/');
await page.evaluate(async () => { const db = await new Promise((res) => { const r = indexedDB.open('canvas-notes'); r.onsuccess = () => res(r.result); }); const tx = db.transaction(['pages'], 'readwrite'); const st = tx.objectStore('pages'); const all = await new Promise((res) => { const q = st.getAll(); q.onsuccess = () => res(q.result); }); for (const p of all) if (p.kind !== 'template') st.delete(p.id); await new Promise((r) => (tx.oncomplete = r)); db.close(); });
await page.reload(); await page.waitForSelector('.phone-tabs'); await page.waitForTimeout(700);
await audit('empty library');
await tab('Cards'); await audit('empty cards');
await tab('Journal'); await audit('empty journal');

/* ---------------- big overlays ---------------- */
await page.evaluate(() => { location.hash = '#/page/sp'; });
await page.waitForTimeout(600);

console.log(`\nconsole errors: ${errors.length}${errors.length ? '\n  ' + errors.join('\n  ') : ''}`);
const bad = report.filter((r) => r.issues.length);
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\n${report.length} screens, ${bad.length} with problems. Screenshots and report.json in ${OUT}`);
await browser.close();
