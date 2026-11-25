/**
 * Script pages (pure). One model for every writing layout: a script is a list of typed elements (scene heading, action, character,
 * dialogue…), and a *format* says how each type is laid out on paper (screenplay, stage play, TV, two-column AV, audio drama, manuscript).
 * The stored form is plain Fountain text (fountain.org), so a script is readable, searchable and exportable by any other tool.
 */
export type ScriptFormat = 'screenplay' | 'tv' | 'stage' | 'av' | 'audio' | 'manuscript';
export const SCRIPT_FORMAT_IDS: readonly ScriptFormat[] = ['screenplay', 'tv', 'stage', 'av', 'audio', 'manuscript'];
export const isScriptFormat = (v: unknown): v is ScriptFormat => typeof v === 'string' && (SCRIPT_FORMAT_IDS as readonly string[]).includes(v);

export type ElType = 'scene' | 'action' | 'character' | 'dialogue' | 'parenthetical' | 'transition' | 'centered' | 'section' | 'synopsis' | 'pagebreak';

export interface ScriptEl {
  type: ElType;
  text: string;
  /** A section's depth (1 = `#`). */
  level?: number;
  /** A character cue spoken at the same time as the next one (Fountain `^`). */
  dual?: boolean;
}

export interface ScriptDoc {
  /** The title page: `[key, value]` in order (Title, Credit, Author, Draft date, Contact…). */
  meta: [string, string][];
  els: ScriptEl[];
}

/** How one element type is set on the page, in characters of a 10-per-inch monospace face (Courier 12 pt). */
export interface ElStyle {
  indent: number;
  width: number;
  /** Blank lines above (dropped at the top of a page). */
  before: number;
  align?: 'left' | 'center' | 'right';
  upper?: boolean;
  bold?: boolean;
  italic?: boolean;
  /** Extra indent of the first line only (a prose paragraph). */
  first?: number;
  /** Not printed (an outline note). */
  hidden?: boolean;
}

export interface FormatSpec {
  id: ScriptFormat;
  label: string;
  about: string;
  /** Margin left of the text and the printed width, in characters. */
  left: number;
  pageLines: number;
  /** 2 = double spaced. */
  step: 1 | 2;
  styles: Record<ElType, ElStyle>;
  /** The element types the writer can choose in this format, in the order of the Tab key. */
  types: ElType[];
  /** Video on the left, sound on the right. */
  columns?: boolean;
  /** Spoken words per minute for the running time of formats that are not "a page a minute". */
  wpm?: number;
  /** What one page is worth: minutes for screenplays, words for a manuscript. */
  rule: string;
}

const hidden: ElStyle = { indent: 0, width: 60, before: 0, hidden: true };
const brk: ElStyle = { indent: 0, width: 0, before: 0, hidden: true };

const SCREEN: Record<ElType, ElStyle> = {
  scene: { indent: 0, width: 60, before: 2, upper: true, bold: true },
  action: { indent: 0, width: 60, before: 1 },
  character: { indent: 22, width: 38, before: 1, upper: true },
  dialogue: { indent: 10, width: 35, before: 0 },
  parenthetical: { indent: 16, width: 20, before: 0 },
  transition: { indent: 0, width: 60, before: 1, upper: true, align: 'right' },
  centered: { indent: 0, width: 60, before: 1, align: 'center' },
  section: hidden,
  synopsis: hidden,
  pagebreak: brk,
};

export const FORMATS: Record<ScriptFormat, FormatSpec> = {
  screenplay: {
    id: 'screenplay',
    label: 'Screenplay',
    about: 'Film and single-camera TV: Courier 12, scene headings, action, centred cues. About one page a minute.',
    left: 15,
    pageLines: 55,
    step: 1,
    styles: SCREEN,
    types: ['action', 'scene', 'character', 'dialogue', 'parenthetical', 'transition', 'centered', 'section', 'synopsis'],
    rule: 'one page ≈ one minute',
  },
  tv: {
    id: 'tv',
    label: 'TV, multi-camera',
    about: 'Sitcom layout: double-spaced dialogue, action in capitals, acts and scenes.',
    left: 15,
    pageLines: 54,
    step: 2,
    styles: {
      ...SCREEN,
      scene: { indent: 0, width: 60, before: 1, upper: true, bold: true },
      action: { indent: 0, width: 60, before: 1, upper: true },
      character: { indent: 20, width: 40, before: 0, upper: true },
      dialogue: { indent: 10, width: 40, before: 0 },
      parenthetical: { indent: 15, width: 30, before: 0, italic: true },
      transition: { indent: 0, width: 60, before: 1, upper: true, align: 'right' },
      centered: { indent: 0, width: 60, before: 1, align: 'center', bold: true },
    },
    types: ['action', 'scene', 'character', 'dialogue', 'parenthetical', 'transition', 'centered', 'section', 'synopsis'],
    rule: 'double spaced: a page ≈ half a minute',
  },
  stage: {
    id: 'stage',
    label: 'Stage play',
    about: 'Theatre: centred act and scene headings, speakers centred over their lines, stage directions in italics.',
    left: 15,
    pageLines: 54,
    step: 1,
    styles: {
      ...SCREEN,
      scene: { indent: 0, width: 60, before: 2, upper: true, bold: true, align: 'center' },
      action: { indent: 20, width: 40, before: 1, italic: true },
      character: { indent: 0, width: 60, before: 1, upper: true, align: 'center' },
      dialogue: { indent: 8, width: 44, before: 0 },
      parenthetical: { indent: 18, width: 30, before: 0, italic: true },
      transition: { indent: 0, width: 60, before: 1, upper: true, align: 'right', italic: true },
      centered: { indent: 0, width: 60, before: 1, align: 'center', bold: true },
    },
    types: ['scene', 'action', 'character', 'dialogue', 'parenthetical', 'transition', 'centered', 'section', 'synopsis'],
    rule: 'one page ≈ one minute',
  },
  av: {
    id: 'av',
    label: 'Two-column (video | audio)',
    about: 'Commercials, explainers and documentaries: pictures on the left, narration, dialogue and sound on the right.',
    left: 10,
    pageLines: 50,
    step: 1,
    columns: true,
    styles: {
      ...SCREEN,
      scene: { indent: 0, width: 32, before: 1, upper: true, bold: true },
      action: { indent: 0, width: 32, before: 0 },
      character: { indent: 38, width: 32, before: 0, upper: true, bold: true },
      dialogue: { indent: 38, width: 32, before: 0 },
      parenthetical: { indent: 38, width: 32, before: 0, italic: true },
      transition: { indent: 0, width: 70, before: 1, upper: true, align: 'right' },
      centered: { indent: 0, width: 70, before: 1, align: 'center' },
    },
    types: ['scene', 'action', 'character', 'dialogue', 'parenthetical', 'transition', 'section', 'synopsis'],
    wpm: 150,
    rule: 'timed by the spoken words (150 a minute)',
  },
  audio: {
    id: 'audio',
    label: 'Audio drama / radio',
    about: 'Podcast and radio plays: scene cues, sound effects and music in brackets, speakers and lines.',
    left: 15,
    pageLines: 54,
    step: 1,
    styles: {
      ...SCREEN,
      scene: { indent: 0, width: 60, before: 2, upper: true, bold: true },
      action: { indent: 0, width: 60, before: 1, upper: true, italic: true },
      character: { indent: 0, width: 60, before: 1, upper: true, bold: true },
      dialogue: { indent: 4, width: 56, before: 0 },
      parenthetical: { indent: 4, width: 50, before: 0, italic: true },
      transition: { indent: 0, width: 60, before: 1, upper: true, align: 'right' },
    },
    types: ['scene', 'action', 'character', 'dialogue', 'parenthetical', 'transition', 'centered', 'section', 'synopsis'],
    wpm: 150,
    rule: 'timed by the spoken words (150 a minute)',
  },
  manuscript: {
    id: 'manuscript',
    label: 'Story manuscript',
    about: 'Short stories and novels: double-spaced prose, chapter headings, a centred # between scenes.',
    left: 10,
    pageLines: 52,
    step: 2,
    styles: {
      ...SCREEN,
      scene: { indent: 0, width: 65, before: 1, align: 'center', bold: true },
      action: { indent: 0, width: 65, before: 0, first: 5 },
      character: { indent: 0, width: 65, before: 0, first: 5 },
      dialogue: { indent: 0, width: 65, before: 0, first: 5 },
      parenthetical: { indent: 0, width: 65, before: 0, first: 5, italic: true },
      transition: { indent: 0, width: 65, before: 1, align: 'center' },
      centered: { indent: 0, width: 65, before: 1, align: 'center' },
      section: { indent: 0, width: 65, before: 3, align: 'center', bold: true, upper: true },
    },
    types: ['action', 'section', 'centered', 'scene', 'synopsis'],
    wpm: 200,
    rule: 'about 250 words a page',
  },
};

export const ELEMENT_LABEL: Record<ElType, string> = {
  scene: 'Scene heading',
  action: 'Action',
  character: 'Character',
  dialogue: 'Dialogue',
  parenthetical: 'Parenthetical',
  transition: 'Transition',
  centered: 'Centred',
  section: 'Outline heading',
  synopsis: 'Note to self',
  pagebreak: 'Page break',
};

/** Words that fit the format: a manuscript calls action "Paragraph", a stage play "Stage direction". */
export function elementLabel(format: ScriptFormat, type: ElType): string {
  if (format === 'manuscript') return ({ action: 'Paragraph', section: 'Chapter', scene: 'Scene title', centered: 'Scene break', synopsis: 'Note to self' } as Partial<Record<ElType, string>>)[type] ?? ELEMENT_LABEL[type];
  if (format === 'stage') return ({ scene: 'Act / scene', action: 'Stage direction', character: 'Speaker', dialogue: 'Speech' } as Partial<Record<ElType, string>>)[type] ?? ELEMENT_LABEL[type];
  if (format === 'av') return ({ scene: 'Shot / location', action: 'Video', character: 'Speaker', dialogue: 'Audio' } as Partial<Record<ElType, string>>)[type] ?? ELEMENT_LABEL[type];
  if (format === 'audio') return ({ scene: 'Scene', action: 'Sound / music cue' } as Partial<Record<ElType, string>>)[type] ?? ELEMENT_LABEL[type];
  return ELEMENT_LABEL[type];
}

export const spec = (f: ScriptFormat): FormatSpec => FORMATS[f];
