import { describe, expect, it } from 'vitest';
import { reportLines, savedPercent } from '../src/lib/storageReport';
import type { StorageReport } from '../src/storage/types';

const base: StorageReport = { pages: 10, pageBytes: 10_000, versions: 0, versionBytes: 0, versionBytesIfCopied: 0, historyBoxes: 0, historyBoxUses: 0, fileUses: 0, files: 0, fileBytes: 0, fileBytesIfCopied: 0, pending: 0 };

describe('the storage report in words', () => {
  it('says nothing was saved when nothing is shared', () => {
    const lines = reportLines({ ...base, fileUses: 2, files: 2, fileBytes: 4000, fileBytesIfCopied: 4000 });
    expect(lines.map((l) => l.label)).toEqual(['Pages', 'Pictures and files', 'Page history']);
    expect(lines.every((l) => l.saved === null)).toBe(true);
    expect(lines[1].note).toBe('2 files kept. A picture you add again is not stored again.');
    expect(lines[2].note).toBe('No saved versions yet.');
  });
  it('says how much sharing saved, and where', () => {
    const lines = reportLines({ ...base, fileUses: 30, files: 6, fileBytes: 240_000, fileBytesIfCopied: 1_200_000, versions: 600, historyBoxes: 4000, versionBytes: 500_000, versionBytesIfCopied: 1_800_000 });
    expect(lines[1].saved).toBe('938 KB');
    expect(lines[1].note).toContain('30 names for 6 distinct files');
    expect(lines[2].saved).not.toBeNull();
    expect(lines[2].note).toContain('600 saved versions made of 4000 distinct boxes');
  });
  it('uses the singular where there is one', () => {
    const lines = reportLines({ ...base, pages: 1, versions: 1, historyBoxes: 1, fileUses: 3, files: 1, fileBytes: 10, fileBytesIfCopied: 30 });
    expect(lines[0].note).toContain('1 page, counting templates and cards');
    expect(lines[1].note).toContain('3 names for 1 distinct file');
    expect(lines[2].note).toContain('1 saved version made of 1 distinct box');
  });
  it('works out the whole saving as a percentage, and never a negative one', () => {
    expect(savedPercent(base)).toBe(0);
    expect(savedPercent({ ...base, fileBytes: 100, fileBytesIfCopied: 100, versionBytes: 100, versionBytesIfCopied: 100 })).toBe(0);
    expect(savedPercent({ ...base, pageBytes: 100, fileBytes: 100, fileBytesIfCopied: 500, versionBytes: 100, versionBytesIfCopied: 300 })).toBe(67); // 600 of 900 bytes saved
    expect(savedPercent({ ...base, versionBytes: 500, versionBytesIfCopied: 100 })).toBe(0); // lists can outweigh tiny boxes: that is not a "saving"
  });
});
