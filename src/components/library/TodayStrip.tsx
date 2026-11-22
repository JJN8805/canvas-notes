import { useMemo } from 'react';
import { dateKey } from '../../lib/daily';
import { deskToday } from '../../lib/todayAll';
import { navigate } from '../../lib/route';
import { useNotes } from '../../store/notes';
import { useActiveWorkspace, useWorkspaceList } from '../../store/workspaces';
import { useFeature } from '../../store/features';
import { openJournal } from '../../store/journal';

/**
 * The top of All pages when you have several workspaces: today in the open one (the day's journal page and the to-dos still open), so
 * each desk starts with what is due. Nothing shows when there is nothing to say, or with only one workspace.
 */
export function TodayStrip() {
  const on = useFeature('workspaces');
  const journalOn = useFeature('journal');
  const pages = useNotes((s) => s.pages);
  const list = useWorkspaceList();
  const open = useActiveWorkspace();
  const here = list.find((w) => w.id === open) ?? list[0];
  const desk = useMemo(() => deskToday(Object.values(pages), here, dateKey()), [pages, here]);
  if (!on || list.length < 2 || (!desk.journal && desk.todoCount === 0)) return null;
  return (
    <section className="today-strip" aria-label={`Today in ${here.name}`}>
      <h2 className="browse-head">Today in {here.name}</h2>
      {journalOn && (
        <button className="ld-name" onClick={() => openJournal(dateKey())}>
          {desk.journal ? `Today’s journal${desk.journal.snippet ? `: ${desk.journal.snippet}` : ' (empty so far)'}` : 'Start today’s journal page'}
        </button>
      )}
      {desk.todoCount > 0 && (
        <ul className="ld-list" aria-label="Still to do">
          {desk.todos.slice(0, 5).map((t, i) => (
            <li key={t.pageId + i}>
              <button className="ld-name" onClick={() => navigate({ name: 'page', id: t.pageId })}>☐ {t.text}</button>
              <span className="ld-chip">{t.page}</span>
            </li>
          ))}
          {desk.todoCount > 5 && <li className="ld-empty">and {desk.todoCount - 5} more</li>}
        </ul>
      )}
    </section>
  );
}
