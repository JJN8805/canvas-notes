/**
 * Story structures to plan with (pure). Each is a list of beats; `structureEls` turns one into outline headings with a one-line note
 * under each beat, ready to write scenes between. The percentages are where the beat usually falls in the whole (the pages of a
 * 110-page script are shown beside it). Sources: Syd Field's three acts, Blake Snyder's Save the Cat beat sheet, the eight-sequence
 * method, Vogler's Hero's Journey and Dan Harmon's Story Circle.
 */
import type { ScriptEl } from './model';

export interface Beat {
  title: string;
  about: string;
  /** Where it usually falls, 0..1. */
  at: number;
  /** Starts an act (a level-1 heading); the rest are level 2. */
  act?: boolean;
}
export interface Structure {
  id: string;
  label: string;
  about: string;
  beats: Beat[];
}

export const STRUCTURES: Structure[] = [
  {
    id: 'three-act',
    label: 'Three acts',
    about: 'Setup, confrontation, resolution, with the two turning points between them.',
    beats: [
      { title: 'Act One: Setup', about: 'Who, where, what is normal, and what is missing.', at: 0, act: true },
      { title: 'Inciting incident', about: 'Something happens that cannot be ignored.', at: 0.12 },
      { title: 'Plot point one', about: 'The hero commits; there is no going back.', at: 0.25 },
      { title: 'Act Two: Confrontation', about: 'Obstacles rise; the hero changes tactics.', at: 0.25, act: true },
      { title: 'Midpoint', about: 'A reversal or revelation that changes the goal.', at: 0.5 },
      { title: 'Plot point two', about: 'All seems lost; the hero finds a last way.', at: 0.75 },
      { title: 'Act Three: Resolution', about: 'The final push, the climax and the new normal.', at: 0.75, act: true },
      { title: 'Climax', about: 'The decisive confrontation.', at: 0.9 },
    ],
  },
  {
    id: 'save-the-cat',
    label: 'Save the Cat (15 beats)',
    about: 'Blake Snyder’s beat sheet for a feature.',
    beats: [
      { title: 'Opening image', about: 'A picture of the world before the change.', at: 0.01 },
      { title: 'Theme stated', about: 'Someone says what the story is really about.', at: 0.05 },
      { title: 'Set-up', about: 'The hero, the flaw, the people around them.', at: 0.05 },
      { title: 'Catalyst', about: 'The life-changing event.', at: 0.1 },
      { title: 'Debate', about: 'Should I go?', at: 0.15 },
      { title: 'Break into Two', about: 'The hero chooses; the new world begins.', at: 0.22 },
      { title: 'B story', about: 'A new relationship that carries the theme.', at: 0.27 },
      { title: 'Fun and games', about: 'The promise of the premise.', at: 0.3 },
      { title: 'Midpoint', about: 'False victory or false defeat; the stakes rise.', at: 0.5 },
      { title: 'Bad guys close in', about: 'Pressure from outside and from within.', at: 0.55 },
      { title: 'All is lost', about: 'The lowest point; a death of some kind.', at: 0.75 },
      { title: 'Dark night of the soul', about: 'The hero faces the truth.', at: 0.8 },
      { title: 'Break into Three', about: 'The answer arrives, from A and B stories together.', at: 0.8 },
      { title: 'Finale', about: 'The lesson is used; the problem is solved.', at: 0.85 },
      { title: 'Final image', about: 'The opposite of the opening image.', at: 0.99 },
    ],
  },
  {
    id: 'sequences',
    label: 'Eight sequences',
    about: 'Eight 12-15 minute movements, each with its own small problem.',
    beats: [
      { title: 'Sequence 1: Status quo and inciting incident', about: '', at: 0 },
      { title: 'Sequence 2: Predicament and lock-in', about: '', at: 0.125 },
      { title: 'Sequence 3: First obstacle and raising the stakes', about: '', at: 0.25 },
      { title: 'Sequence 4: First culmination, midpoint', about: '', at: 0.375 },
      { title: 'Sequence 5: Subplot and rising action', about: '', at: 0.5 },
      { title: 'Sequence 6: Main culmination, all is lost', about: '', at: 0.625 },
      { title: 'Sequence 7: New tension and the twist', about: '', at: 0.75 },
      { title: 'Sequence 8: Resolution', about: '', at: 0.875 },
    ],
  },
  {
    id: 'heros-journey',
    label: 'The Hero’s Journey',
    about: 'Twelve stages (Vogler, after Campbell).',
    beats: [
      { title: 'Ordinary world', about: '', at: 0 },
      { title: 'Call to adventure', about: '', at: 0.1 },
      { title: 'Refusal of the call', about: '', at: 0.15 },
      { title: 'Meeting the mentor', about: '', at: 0.2 },
      { title: 'Crossing the threshold', about: '', at: 0.25 },
      { title: 'Tests, allies, enemies', about: '', at: 0.35 },
      { title: 'Approach to the inmost cave', about: '', at: 0.45 },
      { title: 'The ordeal', about: '', at: 0.5 },
      { title: 'Reward', about: '', at: 0.6 },
      { title: 'The road back', about: '', at: 0.75 },
      { title: 'Resurrection', about: '', at: 0.9 },
      { title: 'Return with the elixir', about: '', at: 0.97 },
    ],
  },
  {
    id: 'story-circle',
    label: 'Story circle (8 steps)',
    about: 'Dan Harmon’s circle, good for a half-hour episode.',
    beats: [
      { title: 'You: a character in a zone of comfort', about: '', at: 0 },
      { title: 'Need: but they want something', about: '', at: 0.12 },
      { title: 'Go: they enter an unfamiliar situation', about: '', at: 0.25 },
      { title: 'Search: they adapt to it', about: '', at: 0.37 },
      { title: 'Find: they get what they wanted', about: '', at: 0.5 },
      { title: 'Take: they pay a heavy price', about: '', at: 0.62 },
      { title: 'Return: they go back to where they started', about: '', at: 0.75 },
      { title: 'Change: now capable of change', about: '', at: 0.87 },
    ],
  },
  {
    id: 'five-act',
    label: 'Five acts (play)',
    about: 'Freytag’s pyramid, the classic shape of a stage play.',
    beats: [
      { title: 'Act I: Exposition', about: 'The world and the people in it.', at: 0, act: true },
      { title: 'Act II: Rising action', about: 'Complications build.', at: 0.2, act: true },
      { title: 'Act III: Climax', about: 'The turning point.', at: 0.5, act: true },
      { title: 'Act IV: Falling action', about: 'Consequences, the last hope.', at: 0.7, act: true },
      { title: 'Act V: Resolution', about: 'The end of the conflict.', at: 0.9, act: true },
    ],
  },
  {
    id: 'tv-hour',
    label: 'TV hour (teaser + 4 acts)',
    about: 'A one-hour drama: a cold open and four acts, each ending on a turn.',
    beats: [
      { title: 'Teaser', about: 'A hook before the titles.', at: 0, act: true },
      { title: 'Act One', about: 'The case or problem arrives.', at: 0.08, act: true },
      { title: 'Act Two', about: 'First attempts fail; complications.', at: 0.3, act: true },
      { title: 'Act Three', about: 'The turn; the stakes rise.', at: 0.55, act: true },
      { title: 'Act Four', about: 'The solution and the button.', at: 0.8, act: true },
    ],
  },
];

export const structureById = (id: string): Structure | undefined => STRUCTURES.find((s) => s.id === id);

/** A structure as outline elements: a heading per beat, a note under it. `pages` shows where it falls in a script of that length. */
export function structureEls(s: Structure, pages = 0): ScriptEl[] {
  const out: ScriptEl[] = [];
  for (const b of s.beats) {
    const where = pages > 0 ? ` (about page ${Math.max(1, Math.round(b.at * pages))})` : '';
    out.push({ type: 'section', text: b.title + where, level: b.act ? 1 : 2 });
    if (b.about) out.push({ type: 'synopsis', text: b.about });
  }
  return out;
}
