import { useEffect, useMemo, useState } from 'react';
import { addDays, dailyPageFor, dailyTitle, dateKey } from '../../lib/daily';
import { entrySnippet, filterEntries, journalEntries, longDate, monthHeading, neighbourEntries, templateLines } from '../../lib/journal';
import { resolveDailyTemplate } from '../../lib/pages';
import { usePrefs } from '../../store/prefs';
import { attendancePagesOf } from '../../lib/pages';
import { setFilter } from '../../store/notes';
import { navigate } from '../../lib/route';
import { openMenu, toast } from '../../store/ui';
import { isEditableTarget } from '../../lib/util';
import { deletePage, openDailyPage, useNotes } from '../../store/notes';
import { confirmDanger } from '../../store/ui';
import { dontRemake, setContents, turnTo, useJournal } from '../../store/journal';
import { useNav } from '../../store/nav';
import { useUi } from '../../store/ui';
import { Editor } from '../editor/Editor';
import { Icon } from '../ui/Icon';
import { CalendarButton } from '../ui/Calendar';

/** The lines the daily template starts every page with, so that what was written can be told from them. */
function useTemplateLines(): Set<string> {
  const pages = useNotes((s) => s.pages);
  const setting = usePrefs((s) => s.dailyTemplate);
  return useMemo(() => templateLines(resolveDailyTemplate(pages, setting)), [pages, setting]);
}

/** A day with no page yet: it is only made when you start it, so turning through the book leaves nothing behind. */
function EmptyDay({ date }: { date: string }) {
  const future = date > dateKey();
  return (
    <div className="book-empty">
      <p>{future ? 'Nothing planned for this day yet.' : 'Nothing written on this day.'}</p>
      <button className="btn primary" onClick={() => { dontRemake(null); openDailyPage(date); }}>
        {future ? 'Plan this day' : 'Start this day'}
      </button>
      <small>Turn the page with the arrows, or press [ and ].</small>
    </div>
  );
}

/** The table of contents: every day that has a page, newest first, by month, with the words each begins with. */
function Contents({ date }: { date: string }) {
  const pages = useNotes((s) => s.pages);
  const [q, setQ] = useState('');
  const fromTemplate = useTemplateLines();
  const entries = useMemo(() => filterEntries(journalEntries(pages), q), [pages, q]);
  const groups = useMemo(() => {
    const out: { heading: string; items: typeof entries }[] = [];
    for (const e of entries) {
      const heading = monthHeading(e.date);
      const last = out[out.length - 1];
      if (last && last.heading === heading) last.items.push(e);
      else out.push({ heading, items: [e] });
    }
    return out;
  }, [entries]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setContents(false);
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, []);
  return (
    <aside className="book-contents" aria-label="Contents">
      <header>
        <strong>Contents</strong>
        <button className="icon-btn" aria-label="Close contents" onClick={() => setContents(false)}>×</button>
      </header>
      <input autoFocus className="field" aria-label="Search the journal" type="search" placeholder="Search the journal…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="book-contents-list">
        {groups.map((g) => (
          <section key={g.heading}>
            <h3>{g.heading}</h3>
            {g.items.map((e) => (
              <button key={e.date} className="book-toc-row" aria-current={e.date === date ? 'true' : undefined} onClick={() => turnTo(e.date)}>
                <span className="when">{longDate(e.date).weekday.slice(0, 3)} {Number(e.date.slice(8))}</span>
                <span className="what">{entrySnippet(e.page, 90, fromTemplate) || <i>nothing written yet</i>}</span>
              </button>
            ))}
          </section>
        ))}
        {!entries.length && <p className="book-toc-empty">{q ? 'No day matches.' : 'No days written yet.'}</p>}
      </div>
    </aside>
  );
}

/**
 * The Journal: the daily pages as a book. The page is the day's real page, which you write on. Turn pages with the arrows (or [ and ]), pick a day from the calendar, or go through the contents.
 */
export function JournalView() {
  const pages = useNotes((s) => s.pages);
  const { date, dir, turns, contents, skipAuto } = useJournal();
  const today = dateKey();
  const entries = useMemo(() => journalEntries(pages), [pages]);
  const page = useNotes((s) => dailyPageFor(s.pages, date));
  const { weekday, rest } = longDate(date);
  const { earlier, later } = neighbourEntries(entries, date);
  const attendance = useMemo(() => attendancePagesOf(pages), [pages]);
  const openAttendance = (el: HTMLElement) => {
    const go = (id: string) => { setFilter({ kind: 'journal' }); navigate({ name: 'page', id }); };
    if (!attendance.length) toast('No attendance yet. On a checklist, choose Track daily, then Attendance.');
    else if (attendance.length === 1) go(attendance[0].id);
    else openMenu(el, attendance.map((p) => ({ label: p.title.replace(/^Attendance:\s*/, '') || 'Attendance', action: () => go(p.id) })));
  };

  // Opening the book at today makes today's page, as the old Today button did; other days wait until you start them.
  // A day whose page you deleted is not made again until you start it.
  useEffect(() => {
    if (date === today && !page && skipAuto !== today) openDailyPage(today);
  }, [date, today, page, skipAuto]);
  const removeDay = async () => {
    if (!page) return;
    const ok = await confirmDanger(`Delete the page for ${dailyTitle(date)}?`, 'It goes to Trash, where you can restore it.', 'Delete page');
    if (!ok) return;
    dontRemake(date);
    void deletePage(page.id);
  };

  // [ and ] turn the page when you are not typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || (e.key !== '[' && e.key !== ']')) return;
      if (isEditableTarget(document.activeElement) || useUi.getState().dialog || useNav.getState().open) return;
      e.preventDefault();
      turnTo(addDays(useJournal.getState().date, e.key === '[' ? -1 : 1));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="journal">
      <div className="main-head journal-bar">
        <div className="main-title">
          <h1>Journal</h1>
          <p>
            {entries.length} day{entries.length === 1 ? '' : 's'} in the journal
          </p>
        </div>
        <div className="controls" role="toolbar" aria-label="Turn the pages">
          <button className="icon-btn" aria-label="Previous day" title="Previous day ([)" onClick={() => turnTo(addDays(date, -1))}>
            <Icon name="back" />
          </button>
          <CalendarButton selected={date} label={dailyTitle(date)} align="right" onPick={turnTo} />
          <button className="icon-btn" aria-label="Next day" title="Next day (])" onClick={() => turnTo(addDays(date, 1))}>
            <span style={{ display: 'inline-flex', transform: 'scaleX(-1)' }}>
              <Icon name="back" />
            </span>
          </button>
          {earlier && earlier !== addDays(date, -1) && (
            <button className="btn" title={`The last day written before this one: ${dailyTitle(earlier)}`} onClick={() => turnTo(earlier)}>
              Earlier entry
            </button>
          )}
          {later && later !== addDays(date, 1) && (
            <button className="btn" title={`The next day written after this one: ${dailyTitle(later)}`} onClick={() => turnTo(later)}>
              Later entry
            </button>
          )}
          {date !== today && (
            <button className="btn" title="Turn to today (Ctrl+Alt+D)" onClick={() => turnTo(today)}>
              <Icon name="today" size={16} />
              Today
            </button>
          )}
          <button className="btn" title="Open the attendance page" onClick={(e) => openAttendance(e.currentTarget)}>
            <Icon name="check" size={16} />
            Attendance
          </button>
          <button className={'btn' + (contents ? ' on' : '')} aria-pressed={contents} onClick={() => setContents(!contents)}>
            <Icon name="outline" size={16} />
            Contents
          </button>
        </div>
      </div>

      <div className="book">
        <div className="book-spread">
          <section key={date} className={'book-page right alone' + (turns > 0 ? (dir === 1 ? ' turn-fwd' : ' turn-back') : '')} aria-label={`The page for ${dailyTitle(date)}`}>
            <header className="book-heading">
              <span className="wd">{weekday}</span>
              <span className="dt">{rest}</span>
              {date === today && <span className="today-flag">Today</span>}
              {page && (
                <button className="icon-btn book-delete" aria-label="Delete this day’s page" title="Delete this day’s page (it goes to Trash)" onClick={() => void removeDay()}>
                  <Icon name="trash" size={16} />
                </button>
              )}
            </header>
            <div className="book-page-body">{page ? <Editor key={page.id} pageId={page.id} variant="journal" /> : <EmptyDay date={date} />}</div>
          </section>
        </div>
        {contents && <Contents date={date} />}
      </div>
    </div>
  );
}
