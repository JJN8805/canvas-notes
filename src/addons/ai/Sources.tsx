import { openBox } from './openBox';
import { citedSources, type NoteSource } from './notesSearch';

/** The notes an answer rests on: the ones it cites, each a button that opens that box (or, if it cites none, the notes it was shown). */
export function Sources({ answer, sources }: { answer: string; sources: NoteSource[] }) {
  const cited = citedSources(answer, sources);
  const shown = cited.length ? cited : sources;
  return (
    <div className="chat-sources" aria-label={cited.length ? 'Sources' : 'Notes it looked at'}>
      <span className="chat-sources-head">{cited.length ? 'From your notes' : 'Looked at (none cited)'}</span>
      {shown.map((s) => (
        <button key={s.n} className="chip src" title={s.text.slice(0, 240)} onClick={() => openBox(s.pageId, s.blockId)}>
          <b>[{s.n}]</b> {s.title}
        </button>
      ))}
    </div>
  );
}
