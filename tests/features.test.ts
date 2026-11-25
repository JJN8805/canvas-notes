import { describe, expect, it } from 'vitest';
import { FEATURES, PROFILES, buildProfile, effectiveOff, isFeatureOn, parseDisabled, profileOf, workspaceOn } from '../src/lib/features';

describe('feature switches', () => {
  it('every feature has a label, a description and a section, with no repeats', () => {
    expect(new Set(FEATURES.map((f) => f.id)).size).toBe(FEATURES.length);
    for (const f of FEATURES) expect(f.label.length && f.description.length && f.section.length).toBeTruthy();
  });
  it('repairs what was saved: unknown names go, repeats go, a damaged value falls back', () => {
    expect(parseDisabled('["journal","nope","journal",3]')).toEqual(['journal']);
    expect(parseDisabled('not json', ['cards'])).toEqual(['cards']);
    expect(parseDisabled('{"a":1}', ['cards'])).toEqual(['cards']);
    expect(parseDisabled(null, ['tags'])).toEqual(['tags']);
    expect(parseDisabled('[]', ['tags'])).toEqual([]); // saved "nothing off" beats the build's default
  });
  it('a feature that needs another is off when that one is off', () => {
    expect(isFeatureOn(['links'], 'graph')).toBe(false);
    expect(isFeatureOn(['graph'], 'links')).toBe(true);
    expect([...effectiveOff(['links'])].sort()).toEqual(['graph', 'links']);
  });
  it('the profiles are what they say', () => {
    const by = (id: string) => PROFILES.find((p) => p.id === id)!;
    expect(by('everything').off).toEqual([]);
    for (const id of ['office', 'documents']) for (const f of ['canvas', 'journal', 'cards', 'groups', 'tags', 'templates', 'links', 'graph', 'space', 'media', 'drawing', 'widgets', 'sync']) expect(by(id).off, `${id} ${f}`).toContain(f);
    expect(by('office').off).not.toContain('doc');
    expect(by('office').off).not.toContain('sheet');
    expect(by('office').off).not.toContain('slides');
    expect(by('documents').off).toContain('slides');
    expect(by('notes').workspace).toBe(false);
  });
  it('recognises a profile from the switches, and calls anything else custom', () => {
    expect(profileOf([], true)).toBe('everything');
    expect(profileOf(PROFILES[1].off, true)).toBe('office');
    expect(profileOf(PROFILES[1].off, false)).toBe('custom');
    expect(profileOf(['journal'], true)).toBe('custom');
    expect(profileOf(['doc', 'sheet', 'slides', 'script'], false)).toBe('notes');
  });
  it('Workspace needs at least one of its four kinds', () => {
    expect(workspaceOn([])).toBe(true);
    expect(workspaceOn(['doc', 'sheet'])).toBe(true);
    expect(workspaceOn(['doc', 'sheet', 'slides'])).toBe(true); // scripts are still on
    expect(workspaceOn(['doc', 'sheet', 'slides', 'script'])).toBe(false);
  });
  it('a build can ship a profile; an unknown or empty one means everything', () => {
    expect(buildProfile('office').id).toBe('office');
    expect(buildProfile('').id).toBe('everything');
    expect(buildProfile('nonsense').id).toBe('everything');
  });
});

describe('the Archive feature', () => {
  it('is a switchable feature in the Pages section: on for everything and notes, off in the Word and Excel only sets', () => {
    const f = FEATURES.find((x) => x.id === 'archive');
    expect(f).toBeDefined();
    expect(f!.section).toBe('Pages');
    const by = (id: string) => PROFILES.find((p) => p.id === id)!;
    for (const id of ['everything', 'notes']) expect(by(id).off).not.toContain('archive');
    for (const id of ['office', 'documents']) expect(by(id).off).toContain('archive');
  });
  it('can be switched off', () => {
    expect(isFeatureOn(['archive'], 'archive')).toBe(false);
    expect(isFeatureOn([], 'archive')).toBe(true);
  });
});
