/** The ways to start a script (pure): Fountain text for each layout, short enough to read through and replace. */
import { serializeScript } from './fountain';
import { structureById, structureEls } from './structures';
import type { ScriptDoc, ScriptFormat } from './model';

export interface ScriptStarter {
  id: string;
  format: ScriptFormat;
  title: string;
  description: string;
  doc: () => ScriptDoc;
}

const meta = (title: string, extra: [string, string][] = []): [string, string][] => [['Title', title], ['Credit', 'Written by'], ['Author', ''], ['Draft date', ''], ...extra].filter(([, v], i) => i === 0 || i === 1 || !!v || false) as [string, string][];

const sceneBody = (): ScriptDoc['els'] => [
  { type: 'scene', text: 'INT. KITCHEN - MORNING' },
  { type: 'action', text: 'Grey light. A kettle ticks as it cools. MARA (30s) stands at the window with a letter she has not opened.' },
  { type: 'character', text: 'MARA' },
  { type: 'parenthetical', text: 'to herself' },
  { type: 'dialogue', text: 'Not today.' },
  { type: 'action', text: 'She slides the letter under the fruit bowl. The kettle clicks off.' },
  { type: 'transition', text: 'CUT TO:' },
  { type: 'scene', text: 'EXT. STREET - CONTINUOUS' },
  { type: 'action', text: '' },
];

export const SCRIPT_STARTERS: ScriptStarter[] = [
  {
    id: 'script-screenplay',
    format: 'screenplay',
    title: 'Screenplay',
    description: 'Film or single-camera TV: scene headings, action, dialogue. Enter and Tab pick the next element.',
    doc: () => ({ meta: meta('Untitled screenplay'), els: sceneBody() }),
  },
  {
    id: 'script-screenplay-outline',
    format: 'screenplay',
    title: 'Screenplay with Save the Cat outline',
    description: 'The fifteen beats as outline headings, with the page each usually falls on, ready to fill with scenes.',
    doc: () => ({ meta: meta('Untitled screenplay'), els: [...structureEls(structureById('save-the-cat')!, 110), { type: 'scene', text: 'INT. ' }] }),
  },
  {
    id: 'script-tv-multicam',
    format: 'tv',
    title: 'TV, multi-camera',
    description: 'A sitcom: double-spaced dialogue, action in capitals, cold open and acts.',
    doc: () => ({
      meta: meta('Untitled sitcom'),
      els: [
        { type: 'section', text: 'Cold open', level: 1 },
        { type: 'scene', text: 'INT. APARTMENT - NIGHT' },
        { type: 'action', text: 'Kim and Ravi argue over a sofa that does not fit through the door.' },
        { type: 'character', text: 'KIM' },
        { type: 'dialogue', text: 'It fits. It just needs to want it more.' },
        { type: 'character', text: 'RAVI' },
        { type: 'parenthetical', text: 'beat' },
        { type: 'dialogue', text: 'The sofa is not a person.' },
      ],
    }),
  },
  {
    id: 'script-stage',
    format: 'stage',
    title: 'Stage play',
    description: 'Acts and scenes centred, speakers over their lines, stage directions in italics.',
    doc: () => ({
      meta: meta('Untitled play', [['Contact', '']]),
      els: [
        { type: 'scene', text: 'ACT ONE, SCENE 1' },
        { type: 'action', text: 'A bare room. One window, high up. A table, two chairs. LIGHTS rise slowly on ANNA, seated, and BEN, standing.' },
        { type: 'character', text: 'ANNA' },
        { type: 'dialogue', text: 'You came back.' },
        { type: 'character', text: 'BEN' },
        { type: 'parenthetical', text: 'not moving' },
        { type: 'dialogue', text: 'I never left.' },
      ],
    }),
  },
  {
    id: 'script-av',
    format: 'av',
    title: 'Two-column (video | audio)',
    description: 'Commercials, explainers, documentaries: what we see beside what we hear.',
    doc: () => ({
      meta: meta('Untitled video'),
      els: [
        { type: 'scene', text: 'OPENING' },
        { type: 'action', text: 'Aerial shot of the harbour at dawn. Titles fade in.' },
        { type: 'character', text: 'NARRATOR' },
        { type: 'dialogue', text: 'Every morning, before the city wakes, the boats go out.' },
        { type: 'action', text: 'Close on a fisherman coiling rope.' },
        { type: 'character', text: 'MUSIC' },
        { type: 'dialogue', text: 'Soft strings in, under narration.' },
      ],
    }),
  },
  {
    id: 'script-audio',
    format: 'audio',
    title: 'Audio drama / podcast',
    description: 'Scene cues, sound effects and music in brackets, speakers and their lines.',
    doc: () => ({
      meta: meta('Untitled audio drama'),
      els: [
        { type: 'scene', text: 'SCENE 1: THE LIGHTHOUSE' },
        { type: 'action', text: 'sea wind, gulls, a heavy door creaking open' },
        { type: 'character', text: 'KEEPER' },
        { type: 'parenthetical', text: 'out of breath' },
        { type: 'dialogue', text: 'Somebody lit the lamp. It was dark an hour ago, I swear it.' },
        { type: 'action', text: 'music: low cello, sustained' },
      ],
    }),
  },
  {
    id: 'script-manuscript',
    format: 'manuscript',
    title: 'Story manuscript',
    description: 'Double-spaced prose in standard manuscript layout, with chapters and scene breaks.',
    doc: () => ({
      meta: meta('Untitled story'),
      els: [
        { type: 'section', text: 'Chapter One', level: 1 },
        { type: 'action', text: 'The ferry had been late every day that week, and Ines had stopped pretending it was the weather.' },
        { type: 'action', text: 'She stood at the rail and counted the gulls. There were eleven.' },
        { type: 'centered', text: '#' },
        { type: 'action', text: '' },
      ],
    }),
  },
  {
    id: 'script-blank',
    format: 'screenplay',
    title: 'Blank screenplay',
    description: 'An empty page.',
    doc: () => ({ meta: [['Title', 'Untitled screenplay']], els: [{ type: 'scene', text: 'INT. ' }] }),
  },
];

export const scriptStarterById = (id: string) => SCRIPT_STARTERS.find((s) => s.id === id);
export const starterText = (s: ScriptStarter): string => serializeScript(s.doc());
