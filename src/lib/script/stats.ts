/** What a script adds up to (pure): pages, running time, scenes, who speaks how much, and where. */
import { characterName, isSceneHeading } from './fountain';
import { layoutPages, pageOfElements } from './layout';
import { FORMATS, type ScriptDoc, type ScriptFormat } from './model';

export interface SceneInfo {
  /** Index of the heading element. */
  index: number;
  /** 1-based number among the scene headings. */
  number: number;
  heading: string;
  page: number;
  /** The `= note` right after the heading, if any. */
  synopsis: string;
  /** Index of the first element after the scene. */
  end: number;
  words: number;
  speakers: string[];
}
export interface CharacterInfo {
  name: string;
  speeches: number;
  words: number;
  scenes: number;
}
export interface OutlineItem {
  index: number;
  level: number;
  title: string;
  page: number;
}
export interface ScriptStats {
  pages: number;
  words: number;
  /** Words spoken (dialogue only). */
  spoken: number;
  /** Running time in minutes, by the rule of the format. */
  minutes: number;
  scenes: SceneInfo[];
  characters: CharacterInfo[];
  outline: OutlineItem[];
}

const countWords = (t: string) => t.split(/\s+/).filter(Boolean).length;

export function scriptStats(doc: ScriptDoc, format: ScriptFormat): ScriptStats {
  const f = FORMATS[format];
  const els = doc.els;
  const pages = layoutPages(els, format).length;
  const at = pageOfElements(els, format);
  const scenes: SceneInfo[] = [];
  const byName = new Map<string, CharacterInfo & { seen: Set<number> }>();
  const outline: OutlineItem[] = [];
  let words = 0;
  let spoken = 0;
  let speaker = '';
  els.forEach((e, i) => {
    const w = e.type === 'synopsis' || e.type === 'section' || e.type === 'pagebreak' ? 0 : countWords(e.text);
    words += w;
    if (e.type === 'section') outline.push({ index: i, level: e.level ?? 1, title: e.text, page: at[i] });
    if (e.type === 'scene' && (isSceneHeading(e.text) || e.text.trim())) {
      scenes.push({ index: i, number: scenes.length + 1, heading: e.text, page: at[i], synopsis: '', end: els.length, words: 0, speakers: [] });
    }
    const scene = scenes[scenes.length - 1];
    if (scene && e.type !== 'scene') {
      scene.words += w;
      if (e.type === 'synopsis' && !scene.synopsis && i === scene.index + 1) scene.synopsis = e.text;
    }
    if (e.type === 'character') speaker = characterName(e.text);
    if (e.type === 'dialogue' && speaker) {
      spoken += w;
      const c = byName.get(speaker) ?? { name: speaker, speeches: 0, words: 0, scenes: 0, seen: new Set<number>() };
      c.speeches++;
      c.words += w;
      if (scene && !c.seen.has(scene.number)) {
        c.seen.add(scene.number);
        c.scenes++;
      }
      byName.set(speaker, c);
      if (scene && !scene.speakers.includes(speaker)) scene.speakers.push(speaker);
    }
  });
  scenes.forEach((s, k) => {
    s.end = scenes[k + 1]?.index ?? els.length;
    // a section heading ends a scene too
    const sec = outline.find((o) => o.index > s.index && o.index < s.end);
    if (sec) s.end = sec.index;
  });
  const minutes = f.wpm ? Math.max(0, Math.round(((format === 'manuscript' ? words : spoken + words * 0.4) / f.wpm) * 10) / 10) : format === 'tv' ? Math.round(pages * 0.5 * 10) / 10 : pages;
  const characters = [...byName.values()].map(({ seen: _seen, ...c }) => c).sort((a, b) => b.words - a.words);
  return { pages, words, spoken, minutes, scenes, characters, outline };
}

/** "1 h 32 min" / "47 min" / "30 s" */
export function formatMinutes(m: number): string {
  if (m < 1) return `${Math.round(m * 60)} s`;
  const t = Math.round(m);
  return t >= 60 ? `${Math.floor(t / 60)} h ${t % 60} min` : `${t} min`;
}
