/** Puts accepted changes on the page: all of them in one step, so a single Undo takes them all back. */
import type { Draft } from 'immer';
import type { Block } from '../../types';
import { BLOCK_DEFAULTS, maxZ, mutatePage, useNotes } from '../../store/notes';
import { canvasApi } from '../../store/canvas';
import { newId } from '../../lib/util';
import { markdownToHtml } from './markdown';
import { fieldsFor, fingerprint, type AliasMap, type ProposedChange } from './edits';

export interface ApplyReport {
  applied: number;
  /** Changes left out because the box changed in the meantime (checked again at the moment of applying). */
  skipped: number;
  /** The boxes that were changed or added, to select them afterwards. */
  touched: string[];
}

/** Applies the changes that have no problem. A box edited since the proposal was made is skipped, never overwritten. */
export function applyChanges(pageId: string, changes: readonly ProposedChange[], aliases: AliasMap): ApplyReport {
  const page = useNotes.getState().pages[pageId];
  const report: ApplyReport = { applied: 0, skipped: 0, touched: [] };
  if (!page) return report;
  const spot = canvasApi.current?.visibleSpot(320, 120) ?? { x: 120, y: 120 };
  let offset = 0;
  mutatePage(pageId, (p) => {
    for (const c of changes) {
      if (c.problem) {
        report.skipped++;
        continue;
      }
      const op = c.op;
      if (op.kind === 'add') {
        const fields =
          op.what === 'checklist'
            ? { ...BLOCK_DEFAULTS.checklist(), items: op.items.map((i, n) => ({ id: `ai${Date.now().toString(36)}${n}`, text: i.text, done: i.done })) }
            : op.what === 'sticky'
              ? { ...BLOCK_DEFAULTS.sticky(), html: markdownToHtml(op.markdown) }
              : { ...BLOCK_DEFAULTS.text(), w: 420, html: markdownToHtml(op.markdown) };
        const id = newId();
        p.blocks.push({ ...fields, id, type: op.what, x: Math.round(spot.x), y: Math.round(spot.y + offset), z: maxZ(p.blocks as Block[]) + 1 } as unknown as Draft<Block>);
        offset += 140;
        report.applied++;
        report.touched.push(id);
        continue;
      }
      const known = aliases[op.box];
      const b = known && p.blocks.find((x) => x.id === known.id);
      // checked again here: the proposal may have sat on screen while the box was edited
      if (!b || fingerprint(b as Block) !== known.fp) {
        report.skipped++;
        continue;
      }
      if (op.kind === 'delete') {
        p.blocks = p.blocks.filter((x) => x.id !== b.id);
        p.arrows = p.arrows.filter((a) => a.from !== b.id && a.to !== b.id);
        for (const o of p.blocks) if (o.frameId === b.id) o.frameId = null;
        report.applied++;
        continue;
      }
      const fields = fieldsFor(op, b as Block);
      if (!fields) {
        report.skipped++;
        continue;
      }
      Object.assign(b, fields);
      report.applied++;
      report.touched.push(b.id);
    }
  });
  return report;
}
