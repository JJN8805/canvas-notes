import { describe, expect, it } from 'vitest';
import { characterName, parseScript, serializeScript } from '../src/lib/script/fountain';
import type { ScriptEl } from '../src/lib/script/model';

const SAMPLE = `Title: Big Fish
Author: Ann
Draft date: 1/2/2026

INT. HOUSE - DAY

Rain taps the glass. She waits.

MARY (V.O.)
(quietly)
I never left.
Not once.

CUT TO:

> THE END <

# Act One

= She decides.

===

.dream sequence

!SHOUT AT THE WALL
`;

describe('Fountain', () => {
  it('reads every element', () => {
    const d = parseScript(SAMPLE);
    expect(d.meta).toEqual([['Title', 'Big Fish'], ['Author', 'Ann'], ['Draft date', '1/2/2026']]);
    expect(d.els.map((e) => e.type)).toEqual(['scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'centered', 'section', 'synopsis', 'pagebreak', 'scene', 'action']);
    expect(d.els[2].text).toBe('MARY (V.O.)');
    expect(d.els[4].text).toBe('I never left.\nNot once.');
    expect(d.els[10].text).toBe('DREAM SEQUENCE');
    expect(d.els[11].text).toBe('SHOUT AT THE WALL');
  });

  it('writes what it reads', () => {
    const d = parseScript(SAMPLE);
    expect(parseScript(serializeScript(d))).toEqual(d);
  });

  it('forces an element only when plain text would be read as something else', () => {
    const els: ScriptEl[] = [
      { type: 'action', text: 'JOHN RUNS' }, // looks like a cue only with a speech under it; alone it is action
      { type: 'action', text: 'INT. is how scenes start' },
      { type: 'action', text: '# not a heading' },
      { type: 'character', text: 'McDonald' },
      { type: 'dialogue', text: 'Hi.' },
      { type: 'scene', text: 'a field' },
      { type: 'transition', text: 'Fade out.' },
    ];
    const back = parseScript(serializeScript({ meta: [], els })).els;
    expect(back.map((e) => e.type)).toEqual(['action', 'action', 'action', 'character', 'dialogue', 'scene', 'transition']);
    expect(back[0].text).toBe('JOHN RUNS');
    expect(back[1].text).toBe('INT. is how scenes start');
    expect(back[2].text).toBe('# not a heading');
    expect(back[3].text).toBe('MCDONALD');
    expect(back[5].text).toBe('A FIELD');
  });

  it('drops empty elements and lone cues instead of writing something else', () => {
    const text = serializeScript({ meta: [], els: [{ type: 'action', text: '' }, { type: 'character', text: 'ANN' }, { type: 'action', text: 'Hello' }] });
    expect(text.trim()).toBe('Hello');
  });

  it('keeps multi-line title values and ignores a boneyard', () => {
    const d = parseScript('Title: X\nContact:\n   a@b.c\n   Street 1\n\n/* hidden\n\nlines */\nINT. A - DAY\n');
    expect(d.meta[1]).toEqual(['Contact', 'a@b.c\nStreet 1']);
    expect(d.els.map((e) => e.type)).toEqual(['scene']);
    expect(parseScript(serializeScript(d)).meta).toEqual(d.meta);
  });

  it('does not take "Mom: hi" for a title page and survives hostile input', () => {
    expect(parseScript('Mom: hello there').meta).toEqual([]);
    expect(() => parseScript('\u0000'.repeat(500) + '\n'.repeat(1000) + '#'.repeat(5000))).not.toThrow();
    expect(parseScript('<script>alert(1)</script>').els[0].text).toBe('<script>alert(1)</script>');
  });

  it('names a character without extensions', () => {
    expect(characterName("mary (V.O.) (CONT'D)")).toBe('MARY');
    expect(characterName('BOB ^')).toBe('BOB');
  });
});
