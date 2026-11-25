import { describe, expect, it } from 'vitest';
import { parseScript, serializeScript } from '../src/lib/script/fountain';
import { layoutPages, pageOfElements, wrap } from '../src/lib/script/layout';
import { scriptStats, formatMinutes } from '../src/lib/script/stats';
import { cycleType, detectType, moveScene, nextAfter, suggest, characterNames } from '../src/lib/script/edit';
import { STRUCTURES, structureEls } from '../src/lib/script/structures';
import { FORMATS, SCRIPT_FORMAT_IDS, type ScriptEl } from '../src/lib/script/model';

const speech = (n: number): ScriptEl[] => [
  { type: 'character', text: 'ANN' },
  { type: 'dialogue', text: Array.from({ length: n }, (_, i) => `word${i}`).join(' ') },
];
const big = (): ScriptEl[] => {
  const els: ScriptEl[] = [];
  for (let i = 0; i < 40; i++) els.push({ type: 'scene', text: `INT. ROOM ${i} - DAY` }, { type: 'action', text: 'She walks across the room and looks out of the window at the rain.' }, ...speech(30));
  return els;
};

describe('wrap', () => {
  it('breaks on words, keeps hard breaks, splits very long words', () => {
    expect(wrap('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc']);
    expect(wrap('a\n\nb', 10)).toEqual(['a', '', 'b']);
    expect(wrap('x'.repeat(25), 10)).toEqual(['x'.repeat(10), 'x'.repeat(10), 'xxxxx']);
  });
});

describe('layout', () => {
  it('sets a screenplay on 55-line pages and numbers them', () => {
    const pages = layoutPages(big(), 'screenplay');
    expect(pages.length).toBeGreaterThan(5);
    for (const p of pages) expect(p.lines.length).toBeLessThanOrEqual(FORMATS.screenplay.pageLines);
    expect(pages.map((p) => p.number)).toEqual(pages.map((_, i) => i + 1));
  });

  it('indents each element as the format says', () => {
    const [p] = layoutPages([{ type: 'scene', text: 'int. a - day' }, { type: 'character', text: 'Ann' }, { type: 'dialogue', text: 'Hi.' }, { type: 'transition', text: 'cut to:' }], 'screenplay');
    const by = (t: string) => p.lines.find((l) => l.text === t)!;
    expect(by('INT. A - DAY').col).toBe(0);
    expect(by('ANN').col).toBe(22);
    expect(by('Hi.').col).toBe(10);
    expect(by('CUT TO:').col).toBe(60 - 'CUT TO:'.length);
  });

  it('keeps a scene heading or a cue with the line after it', () => {
    const els: ScriptEl[] = [];
    for (let i = 0; i < 53; i++) els.push({ type: 'action', text: `line ${i}`, });
    els.push({ type: 'scene', text: 'INT. END - NIGHT' }, { type: 'action', text: 'After.' });
    const pages = layoutPages(els, 'screenplay');
    const last = pages[pages.length - 1].lines.map((l) => l.text);
    expect(last).toContain('INT. END - NIGHT');
    expect(last).toContain('After.');
  });

  it('splits a long speech with (MORE) and (CONT\'D)', () => {
    const els: ScriptEl[] = [];
    for (let i = 0; i < 20; i++) els.push({ type: 'action', text: `a${i}` });
    els.push(...speech(400));
    const pages = layoutPages(els, 'screenplay');
    const text = pages.flatMap((p) => p.lines.map((l) => l.text));
    expect(text).toContain('(MORE)');
    expect(text).toContain("ANN (CONT'D)");
    for (const p of pages) expect(p.lines.length).toBeLessThanOrEqual(55);
  });

  it('double spaces a manuscript and shows audio cues in brackets', () => {
    const m = layoutPages([{ type: 'action', text: 'one two three' }, { type: 'action', text: 'four' }], 'manuscript')[0].lines.map((l) => l.text);
    expect(m[0].trim()).toBe('one two three');
    expect(m).toContain('');
    const a = layoutPages([{ type: 'action', text: 'door slams' }], 'audio')[0].lines[0].text;
    expect(a).toBe('[DOOR SLAMS]');
  });

  it('puts picture and sound side by side in the two-column format', () => {
    const [p] = layoutPages([{ type: 'action', text: 'A dog runs.' }, { type: 'character', text: 'Nina' }, { type: 'dialogue', text: 'Good boy.' }], 'av');
    const line = p.lines.find((l) => l.right?.text === 'NINA');
    expect(line?.text).toBe('A dog runs.');
    expect(line?.right?.col).toBe(38);
  });

  it('honours page breaks and tells where an element starts', () => {
    const els: ScriptEl[] = [{ type: 'action', text: 'one' }, { type: 'pagebreak', text: '' }, { type: 'action', text: 'two' }];
    expect(layoutPages(els, 'screenplay')).toHaveLength(2);
    expect(pageOfElements(els, 'screenplay')).toEqual([1, 2, 2]);
  });

  it('lays out every format without error, even for hostile text', () => {
    const hostile: ScriptEl[] = [{ type: 'scene', text: '\u0000'.repeat(300) }, { type: 'dialogue', text: 'x'.repeat(5000) }, { type: 'section', text: '#', level: 99 }];
    for (const f of SCRIPT_FORMAT_IDS) expect(() => layoutPages([...big(), ...hostile], f)).not.toThrow();
  });
});

describe('statistics', () => {
  const doc = parseScript(`INT. KITCHEN - DAY\n\n= Ann hides the letter.\n\nANN\nHello there my friend.\n\nBOB\nHi.\n\nANN\nBye.\n\nEXT. STREET - NIGHT\n\nBOB\nCold.\n`);
  it('lists scenes with their synopsis, page and speakers', () => {
    const s = scriptStats(doc, 'screenplay');
    expect(s.scenes.map((x) => x.heading)).toEqual(['INT. KITCHEN - DAY', 'EXT. STREET - NIGHT']);
    expect(s.scenes[0].synopsis).toBe('Ann hides the letter.');
    expect(s.scenes[0].speakers).toEqual(['ANN', 'BOB']);
    expect(s.pages).toBe(1);
  });
  it('counts who speaks most', () => {
    const c = scriptStats(doc, 'screenplay').characters;
    expect(c[0]).toMatchObject({ name: 'ANN', speeches: 2, words: 5, scenes: 1 });
    expect(c.find((x) => x.name === 'BOB')).toMatchObject({ speeches: 2, scenes: 2 });
  });
  it('times audio by words and formats minutes', () => {
    expect(scriptStats(doc, 'audio').minutes).toBeGreaterThan(0);
    expect(formatMinutes(0.5)).toBe('30 s');
    expect(formatMinutes(47)).toBe('47 min');
    expect(formatMinutes(92)).toBe('1 h 32 min');
  });
});

describe('editing rules', () => {
  it('follows Enter like a screenwriting program', () => {
    expect(nextAfter('character', 'screenplay')).toBe('dialogue');
    expect(nextAfter('dialogue', 'screenplay')).toBe('action');
    expect(nextAfter('scene', 'screenplay')).toBe('action');
    expect(nextAfter('transition', 'screenplay')).toBe('scene');
    expect(nextAfter('scene', 'stage')).toBe('character');
  });
  it('cycles types with Tab, both ways, within the format', () => {
    let t = cycleType('action', 'manuscript');
    expect(['action', 'section', 'centered', 'scene']).toContain(t);
    expect(cycleType(cycleType('action', 'screenplay'), 'screenplay', true)).toBe('action');
  });
  it('turns "INT. " and "CUT TO:" into what they are', () => {
    expect(detectType('action', 'INT. HOUSE - DAY', 'screenplay')).toBe('scene');
    expect(detectType('action', 'CUT TO:', 'screenplay')).toBe('transition');
    expect(detectType('action', 'He sits.', 'screenplay')).toBe('action');
    expect(detectType('action', 'INT. HOUSE - DAY', 'manuscript')).toBe('action');
  });
  it('completes places, times, names and transitions', () => {
    const els: ScriptEl[] = [{ type: 'scene', text: 'INT. KITCHEN - DAY' }, { type: 'character', text: 'ANNA' }, { type: 'character', text: 'ANNA' }, { type: 'character', text: 'ANDY' }, { type: 'character', text: 'an' }, { type: 'scene', text: 'int. kit' }, { type: 'scene', text: 'INT. ROOM - N' }, { type: 'transition', text: 'cu' }, { type: 'scene', text: '' }];
    expect(suggest(els, 4)).toEqual(['ANNA', 'ANDY']);
    expect(suggest(els, 5)).toEqual(['INT. KITCHEN']);
    expect(suggest(els, 6)).toEqual(['INT. ROOM - NIGHT']);
    expect(suggest(els, 7)).toEqual(['CUT TO:']);
    expect(suggest(els, 8)).toEqual(['INT. ', 'EXT. ', 'INT./EXT. ']);
    expect(characterNames(els)).toEqual(['ANNA', 'AN', 'ANDY']);
  });
  it('moves a scene with everything in it', () => {
    const els = parseScript('INT. A - DAY\n\none\n\nINT. B - DAY\n\ntwo\n\nthree\n\nINT. C - DAY\n\nfour\n').els;
    const down = moveScene(els, 0, 1);
    expect(down.els.map((e) => e.text)).toEqual(['INT. B - DAY', 'two', 'three', 'INT. A - DAY', 'one', 'INT. C - DAY', 'four']);
    expect(down.index).toBe(3);
    const up = moveScene(down.els, 3, -1);
    expect(up.els).toEqual(els);
    expect(moveScene(els, 6 - 2, 1).els).toEqual(els); // last scene cannot go down
    expect(moveScene(els, 0, -1).els).toEqual(els);
  });
});

describe('structures', () => {
  it('turns every structure into outline headings that survive the file format', () => {
    for (const s of STRUCTURES) {
      const els = structureEls(s, 110);
      expect(els.filter((e) => e.type === 'section')).toHaveLength(s.beats.length);
      const back = parseScript(serializeScript({ meta: [], els })).els;
      expect(back.filter((e) => e.type === 'section').map((e) => e.text)).toEqual(els.filter((e) => e.type === 'section').map((e) => e.text));
    }
    expect(structureEls(STRUCTURES[0], 120)[2].text).toContain('about page 14');
  });
});

describe('renaming and notes', () => {
  it('renames every cue and keeps extensions', async () => {
    const { renameCharacter, setSynopsis } = await import('../src/lib/script/edit');
    const els: ScriptEl[] = [{ type: 'character', text: 'ANN' }, { type: 'dialogue', text: 'x' }, { type: 'character', text: 'ann (V.O.)' }, { type: 'character', text: 'BOB' }];
    const r = renameCharacter(els, 'Ann', 'Anna');
    expect(r.changed).toBe(2);
    expect(r.els.map((e) => e.text)).toEqual(['ANNA', 'x', 'ANNA (V.O.)', 'BOB']);
    expect(renameCharacter(els, 'ANN', '').changed).toBe(0);
    const s = setSynopsis([{ type: 'scene', text: 'A' }, { type: 'action', text: 'b' }], 0, 'idea');
    expect(s[1]).toEqual({ type: 'synopsis', text: 'idea' });
    expect(setSynopsis(s, 0, 'better')[1].text).toBe('better');
    expect(setSynopsis(s, 0, '')).toHaveLength(2);
  });
});

describe('script files', () => {
  const doc = parseScript('Title: Big Fish\nCredit: Written by\nAuthor: Ann\n\nINT. HOUSE - DAY\n\nShe waits.\n\nMARY\nHi “you” — ok.\n');
  it('writes text laid out like the page, with the title page first', async () => {
    const { scriptToText } = await import('../src/lib/script/export');
    const t = scriptToText(doc, 'screenplay');
    expect(t).toContain('BIG FISH');
    expect(t).toContain('\f');
    expect(t).toMatch(/^ {15}INT\. HOUSE - DAY$/m);
    expect(t).toMatch(/^ {37}MARY$/m);
  });
  it('writes a PDF whose offsets are right and whose text is real', async () => {
    const { scriptToPdf } = await import('../src/lib/script/export');
    const bytes = scriptToPdf(doc, 'screenplay');
    const s = new TextDecoder('latin1').decode(bytes);
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s).toContain('/Count 2');
    const at = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(at, at + 4)).toBe('xref');
    [...s.matchAll(/(\d{10}) 00000 n/g)].forEach((m, k) => expect(s.slice(Number(m[1])).startsWith(`${k + 1} 0 obj\n`)).toBe(true));
    expect(s).toContain('(INT. HOUSE - DAY) Tj');
    expect(s).toContain('/BaseFont /Courier-Bold');
    expect(bytes.includes(0x93) && bytes.includes(0x97)).toBe(true); // curly quotes and the dash as WinAnsi bytes
    expect(s).toContain('Hi “you” — ok.');
  });
  it('survives text a standard font cannot draw, and parentheses', async () => {
    const { scriptToPdf } = await import('../src/lib/script/export');
    const s = new TextDecoder('latin1').decode(scriptToPdf(parseScript('INT. A - DAY\n\n日本語 (ok) \\ done\n'), 'screenplay'));
    expect(s).toContain('(??? \\(ok\\) \\\\ done) Tj');
  });
});
