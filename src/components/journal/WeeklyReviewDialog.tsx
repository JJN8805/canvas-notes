import { confirmsOnEnter, enterKey } from '../../lib/enterConfirm';
import { useEffect, useMemo, useRef } from 'react';
import { askHandler, useAddons } from '../../addons/store';
import { dailyTitle, dateKey } from '../../lib/daily';
import { templateLines } from '../../lib/journal';
import { libraryPages, resolveDailyTemplate } from '../../lib/pages';
import { navigate } from '../../lib/route';
import { buildWeekly } from '../../lib/weekly';
import { closeWeekly, createWeeklyPage, useWeekly } from '../../store/weekly';
import { usePrefs } from '../../store/prefs';
import { useNotes } from '../../store/notes';
import { toast } from '../../store/ui';

const REFLECT =
  'Write a short, honest reflection on my week from this page: what went well, what slipped, and what to focus on next week. Keep it under 150 words and use only what is on the page.';

/**
 * "Review the week": what the week looked like (days written, tasks done and still open, daily habits, pages worked on), worked out on this
 * computer from the pages already there. Nothing is made until "Create page". If an AI add-on is on, the page can then be handed to it for
 * a reflection; that goes through the same "this is what will be sent" step as any other question.
 */
export function WeeklyReviewDialog() {
  const date = useWeekly((s) => s.date);
  const pages = useNotes((s) => s.pages);
  const setting = usePrefs((s) => s.dailyTemplate);
  useAddons((s) => s.loaded); // an add-on starting or stopping changes whether "ask AI" is offered
  const draft = useMemo(
    () => (date ? buildWeekly(pages, date, dateKey(), templateLines(resolveDailyTemplate(pages, setting))) : null),
    [date, pages, setting],
  );
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (date) primary.current?.focus();
  }, [date]);
  if (!date || !draft) return null;

  const existing = libraryPages(pages).find((p) => !p.dailyDate && p.title === draft.title);
  const ask = askHandler();
  const create = (andAsk: boolean) => {
    const page = createWeeklyPage(draft);
    closeWeekly();
    if (andAsk && ask) {
      ask(REFLECT, { pageIds: [page.id] });
      return;
    }
    toast(`Created “${draft.title}”`, { label: 'Open', run: () => navigate({ name: 'page', id: page.id }) });
  };
  const s = draft.stats;
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && closeWeekly()}>
      <div className="dialog weekly" role="dialog" aria-modal="true" aria-label="Review the week" onKeyDown={(e) => {
        if (e.key === 'Escape') return void (e.stopPropagation(), closeWeekly());
        if (!draft.empty && confirmsOnEnter(enterKey(e))) (e.preventDefault(), create(false));
      }}>
        <h2>{draft.title}</h2>
        <p className="weekly-sub">
          {s.daysWritten} {s.daysWritten === 1 ? 'day' : 'days'} written · {s.tasksDone} done · {s.tasksOpen} still open · {s.pagesTouched} {s.pagesTouched === 1 ? 'page' : 'pages'} worked on
        </p>
        {draft.empty ? (
          <p>Nothing to review yet: no days written, no to-dos on the daily pages, no daily habits and no pages edited this week.</p>
        ) : (
          <div className="weekly-body">
            <section aria-label="The days">
              <h3>The days</h3>
              <ul>
                {draft.days.map((d) => (
                  <li key={d.date} title={dailyTitle(d.date)}>
                    <b>{d.label}</b> {d.written ? `– ${d.written}` : <em>{d.hasPage ? '– nothing written' : '– no page'}</em>}
                  </li>
                ))}
              </ul>
            </section>
            {draft.openTasks.length > 0 && (
              <section aria-label="Still open">
                <h3>Still open</h3>
                <ul>{draft.openTasks.map((t) => <li key={t}>{t}</li>)}</ul>
              </section>
            )}
            {draft.doneTasks.length > 0 && (
              <section aria-label="Done this week">
                <h3>Done this week</h3>
                <ul>{draft.doneTasks.map((t) => <li key={t}>{t}</li>)}</ul>
              </section>
            )}
            {draft.habits.length > 0 && (
              <section aria-label="Daily habits">
                <h3>Daily habits</h3>
                <ul>{draft.habits.map((h) => <li key={h.list + h.text}>{h.text}: {h.done} of {h.counted}{h.streak ? `, ${h.streak}-day streak` : ''}</li>)}</ul>
              </section>
            )}
            {draft.touched.length > 0 && (
              <section aria-label="Pages I worked on">
                <h3>Pages I worked on</h3>
                <ul>{draft.touched.map((p) => <li key={p.id}>{p.title}</li>)}</ul>
              </section>
            )}
          </div>
        )}
        {existing && (
          <p className="weekly-existing">
            A page called “{draft.title}” already exists.{' '}
            <button className="link-btn" onClick={() => { closeWeekly(); navigate({ name: 'page', id: existing.id }); }}>Open it</button>
          </p>
        )}
        <p className="weekly-note">Nothing is saved until you press Create page. The page is an ordinary page: edit it, move things, or delete it.</p>
        <div className="row">
          <button className="btn" onClick={closeWeekly}>Cancel</button>
          {ask && !draft.empty && (
            <button className="btn" onClick={() => create(true)} title="Make the page, then ask the AI assistant for a short reflection on it. You will see what is sent before a cloud or network model gets it.">
              Create page and ask AI to reflect
            </button>
          )}
          <button ref={primary} className="btn primary" disabled={draft.empty} onClick={() => create(false)}>{existing ? 'Create another page' : 'Create page'}</button>
        </div>
      </div>
    </div>
  );
}
