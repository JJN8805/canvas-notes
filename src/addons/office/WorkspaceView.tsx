import { useMemo } from 'react';
import { OFFICE_LABEL, pageApp, type OfficeApp } from '../../lib/office/app';
import { startersFor } from '../../lib/office/starters';
import { listedPages } from '../../lib/pages';
import { navigate } from '../../lib/route';
import { createOfficePage } from '../../store/office';
import { useNotes } from '../../store/notes';
import { Icon, type IconName } from '../../components/ui/Icon';

const APPS: { app: OfficeApp; icon: IconName; about: string }[] = [
  { app: 'doc', icon: 'edit', about: 'Write on a sheet of paper, with headings, lists and a word count.' },
  { app: 'sheet', icon: 'table', about: 'Rows, columns, formulas, number formats, sorting and CSV.' },
  { app: 'slides', icon: 'frame', about: 'Slides you can reorder, with speaker notes and a full-screen show.' },
];

/** The Workspace screen: start a document, spreadsheet or presentation from a blank page or a ready-made starter, and reopen what you made. */
export function WorkspaceView() {
  const pages = useNotes((s) => s.pages);
  const mine = useMemo(
    () =>
      listedPages(pages)
        .map((p) => ({ p, app: pageApp(p) }))
        .filter((x): x is { p: (typeof x)['p']; app: OfficeApp } => !!x.app)
        .sort((a, b) => b.p.updated - a.p.updated),
    [pages],
  );
  const open = (app: OfficeApp, starterId: string) => {
    const page = createOfficePage(app, starterId);
    if (page) navigate({ name: 'page', id: page.id });
  };
  return (
    <>
      <div className="main-head">
        <div className="main-title">
          <h1>Workspace</h1>
          <p>Documents, spreadsheets and presentations. They are ordinary pages: they sync, link, back up and export like the rest.</p>
        </div>
      </div>
      <div className="office-hub">
        {APPS.map(({ app, icon, about }) => (
          <section key={app} className="office-col" aria-label={OFFICE_LABEL[app]}>
            <h2><Icon name={icon} size={18} /> {OFFICE_LABEL[app]}s</h2>
            <p>{about}</p>
            <div className="office-starters">
              {startersFor(app).map((s, i) => (
                <button key={s.id} className={`office-starter${i === 0 ? ' blank' : ''}`} onClick={() => open(app, s.id)} title={s.description}>
                  <strong>{s.title}</strong>
                  <span>{s.description}</span>
                </button>
              ))}
            </div>
            <h3>Recent</h3>
            <ul className="office-recent">
              {mine.filter((x) => x.app === app).slice(0, 8).map(({ p }) => (
                <li key={p.id}>
                  <button className="link" onClick={() => navigate({ name: 'page', id: p.id })}>{p.title.trim() || 'Untitled'}</button>
                  <time dateTime={new Date(p.updated).toISOString()}>{new Date(p.updated).toLocaleDateString()}</time>
                </li>
              ))}
              {!mine.some((x) => x.app === app) && <li className="none">Nothing yet.</li>}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
