import { useState } from 'react';
import { characterName } from '../../lib/script/fountain';
import { formatMinutes, type ScriptStats } from '../../lib/script/stats';
import { FORMATS, type ScriptDoc, type ScriptFormat } from '../../lib/script/model';
import { STRUCTURES } from '../../lib/script/structures';
import { metaValue } from '../../lib/script/fountain';
import { Icon, type IconName } from '../ui/Icon';
import { ask } from '../../store/ui';

export type NavTab = 'scenes' | 'cards' | 'people' | 'plan' | 'title';
export const NAV_TABS: { id: NavTab; label: string; icon: IconName }[] = [
  { id: 'scenes', label: 'Scenes', icon: 'bullets' },
  { id: 'cards', label: 'Cards', icon: 'card' },
  { id: 'people', label: 'People', icon: 'user' },
  { id: 'plan', label: 'Plan', icon: 'map' },
  { id: 'title', label: 'Title', icon: 'book' },
];

interface Props {
  tab: NavTab;
  setTab: (t: NavTab) => void;
  format: ScriptFormat;
  stats: ScriptStats;
  meta: ScriptDoc['meta'];
  onMeta: (key: string, value: string) => void;
  goTo: (elIndex: number) => void;
  moveScene: (elIndex: number, dir: -1 | 1) => void;
  setSynopsis: (sceneIndex: number, text: string) => void;
  rename: (from: string, to: string) => void;
  addStructure: (id: string, pages: number) => void;
}

/** The side panel: the scene list, the scenes as index cards, who speaks, the story structures and the title page. */
export function ScriptNav(p: Props) {
  const [pages, setPages] = useState(() => (p.format === 'manuscript' ? 300 : p.format === 'tv' ? 30 : 110));
  const { stats } = p;
  const f = FORMATS[p.format];
  return (
    <aside className="sc-nav" aria-label="Script navigator">
      <div className="sc-tabs" role="tablist">
        {NAV_TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={p.tab === t.id} className={p.tab === t.id ? 'on' : ''} onClick={() => p.setTab(t.id)} title={t.id === 'title' ? 'Title page' : t.label} aria-label={t.id === 'title' ? 'Title page' : t.label}>
            <Icon name={t.icon} size={16} />
            <span className="sc-lbl">{t.label}</span>
          </button>
        ))}
      </div>
      <div className="sc-nav-body">
        {p.tab === 'scenes' && (
          <ol className="sc-scenes">
            {stats.outline.map((o) => (
              <li key={`o${o.index}`} className="sc-sec" style={{ paddingLeft: (o.level - 1) * 12 }}>
                <button onClick={() => p.goTo(o.index)}>{o.title || 'Untitled heading'}</button>
                <span>p. {o.page}</span>
              </li>
            ))}
            {stats.scenes.length === 0 && <li className="sc-empty">No scene headings yet. Start a line with INT. or EXT., or press Tab on an empty line until it says “{f.id === 'manuscript' ? 'Scene title' : 'Scene heading'}”.</li>}
            {stats.scenes.map((s) => (
              <li key={s.index}>
                <button className="sc-go" onClick={() => p.goTo(s.index)}>
                  <b>{s.number}</b> {s.heading || 'Untitled scene'}
                </button>
                <span>p. {s.page}</span>
                <span className="sc-move">
                  <button aria-label={`Move scene ${s.number} up`} title="Move scene up" onClick={() => p.moveScene(s.index, -1)}>▲</button>
                  <button aria-label={`Move scene ${s.number} down`} title="Move scene down" onClick={() => p.moveScene(s.index, 1)}>▼</button>
                </span>
              </li>
            ))}
          </ol>
        )}
        {p.tab === 'cards' && (
          <div className="sc-cards">
            {stats.scenes.length === 0 && <p className="sc-empty">Scenes appear here as index cards once you have scene headings.</p>}
            {stats.scenes.map((s) => (
              <div key={s.index} className="sc-card">
                <button className="sc-card-head" onClick={() => p.goTo(s.index)}>
                  <b>{s.number}</b> {s.heading || 'Untitled scene'}
                </button>
                <textarea aria-label={`Summary of scene ${s.number}`} placeholder="What happens in this scene?" value={s.synopsis} rows={3} onChange={(e) => p.setSynopsis(s.index, e.target.value)} />
                <div className="sc-card-foot">
                  <span>p. {s.page}{s.speakers.length ? ` · ${s.speakers.slice(0, 3).join(', ')}` : ''}</span>
                  <span className="sc-move">
                    <button aria-label={`Move scene ${s.number} earlier`} title="Move earlier" onClick={() => p.moveScene(s.index, -1)}>◀</button>
                    <button aria-label={`Move scene ${s.number} later`} title="Move later" onClick={() => p.moveScene(s.index, 1)}>▶</button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        {p.tab === 'people' && (
          <table className="sc-people">
            <thead>
              <tr><th>Name</th><th>Speeches</th><th>Words</th><th>Scenes</th><th /></tr>
            </thead>
            <tbody>
              {stats.characters.map((c) => (
                <tr key={c.name}>
                  <td>{c.name}</td>
                  <td>{c.speeches}</td>
                  <td>{c.words}</td>
                  <td>{c.scenes}</td>
                  <td>
                    <button className="btn small" title={`Rename ${c.name} everywhere`} aria-label={`Rename ${c.name}`} onClick={() => void ask({ title: `Rename ${c.name} everywhere`, initial: c.name, okLabel: 'Rename' }).then((to) => to && characterName(to) !== c.name && p.rename(c.name, to))}>
                      <Icon name="rename" size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {stats.characters.length === 0 && <tr><td colSpan={5} className="sc-empty">Nobody speaks yet.</td></tr>}
            </tbody>
          </table>
        )}
        {p.tab === 'plan' && (
          <div className="sc-plan">
            <label>
              Length to plan for ({p.format === 'manuscript' ? 'pages' : 'pages'})
              <input className="field small" type="number" min={1} max={999} value={pages} onChange={(e) => setPages(Math.max(1, Math.min(999, Number(e.target.value) || 1)))} />
            </label>
            {STRUCTURES.map((s) => (
              <div key={s.id} className="sc-struct">
                <b>{s.label}</b>
                <p>{s.about}</p>
                <button className="btn small" onClick={() => p.addStructure(s.id, pages)}>
                  <Icon name="plus" size={14} /> Add outline to the script
                </button>
              </div>
            ))}
            <p className="sc-empty">Outline headings and notes are not printed; they show in the scene list and are written to the file as # headings and = notes.</p>
          </div>
        )}
        {p.tab === 'title' && (
          <div className="sc-title">
            {(['Title', 'Credit', 'Author', 'Draft date', 'Contact'] as const).map((k) => (
              <label key={k}>
                {k}
                {k === 'Contact' ? (
                  <textarea className="field" rows={3} value={metaValue({ meta: p.meta, els: [] }, k)} onChange={(e) => p.onMeta(k, e.target.value)} />
                ) : (
                  <input className="field" value={metaValue({ meta: p.meta, els: [] }, k)} onChange={(e) => p.onMeta(k, e.target.value)} />
                )}
              </label>
            ))}
            <p className="sc-empty">Printed on the first page of a PDF or text export.</p>
          </div>
        )}
      </div>
      <div className="sc-sum" role="status">
        <span>{stats.pages} {stats.pages === 1 ? 'page' : 'pages'}</span>
        <span>{formatMinutes(stats.minutes)}</span>
        <span>{stats.scenes.length} {stats.scenes.length === 1 ? 'scene' : 'scenes'}</span>
        <span>{stats.words.toLocaleString()} words</span>
        <small>{f.rule}</small>
      </div>
    </aside>
  );
}
