import { useMemo } from 'react';
import { docBlock } from '../../lib/office/app';
import { DOC_WIDTH } from '../../lib/office/starters';
import { htmlToText } from '../../lib/pageText';
import { setDocSize } from '../../store/office';
import { useNotes } from '../../store/notes';
import { BlockBody } from '../blocks/BlockBody';
import { FormatBar } from '../editor/Editor';
import { CanvasCtx } from '../editor/context';
import { soloCtx } from '../editor/soloCtx';

const PAGE_HEIGHT = { letter: 1056, a4: 1123 } as const; // a printed page at 96 dpi
const WORDS_PER_PAGE = 500;

/** A document: one sheet of paper to write on, with the formatting bar above it and a count of words below. */
export function DocScreen({ pageId }: { pageId: string }) {
  const doc = useNotes((s) => docBlock(s.pages[pageId]?.blocks ?? []));
  const html = doc?.html ?? '';
  const stats = useMemo(() => {
    const text = htmlToText(html);
    const words = text.split(/\s+/).filter(Boolean).length;
    return { words, chars: text.replace(/\s/g, '').length, pages: Math.max(1, Math.ceil(words / WORDS_PER_PAGE)) };
  }, [html]);
  const ctx = useMemo(() => soloCtx(pageId), [pageId]);
  if (!doc) return null;
  const size = doc.doc?.size ?? 'letter';
  return (
    <div className="doc-screen">
      <FormatBar pageId={pageId} />
      <div className="doc-scroll">
        <div className="doc-paper" style={{ width: DOC_WIDTH[size], minHeight: PAGE_HEIGHT[size] }}>
          <CanvasCtx.Provider value={ctx}>
            <div className="block b-text">
              <BlockBody block={doc} />
            </div>
          </CanvasCtx.Provider>
        </div>
      </div>
      <div className="doc-status" role="status">
        <span>{stats.words.toLocaleString()} words</span>
        <span>{stats.chars.toLocaleString()} characters</span>
        <span>about {stats.pages} {stats.pages === 1 ? 'page' : 'pages'}</span>
        <span className="doc-spacer" />
        <label>
          Paper{' '}
          <select className="field small" aria-label="Paper size" value={size} onChange={(e) => setDocSize(pageId, e.target.value as 'letter' | 'a4')}>
            <option value="letter">Letter</option>
            <option value="a4">A4</option>
          </select>
        </label>
      </div>
    </div>
  );
}
