import { useMemo } from 'react';
import { useNotes } from '../../store/notes';
import { useAddons } from '../../addons/store';
import { libraryPages } from '../../lib/pages';
import { toast } from '../../store/ui';
import { APP_NAME, buildInfo, describeEnvironment, diagnosticsText, formatBuildDate } from '../../lib/appInfo';
import { CHANGELOG } from '../../lib/changelog';
import { Section } from './SettingsParts';

/** Settings → General: which version this is and where it was built, the system it runs on, how big the library is, and what is new. */
export function GeneralTab() {
  const pages = useNotes((s) => s.pages);
  const groups = useNotes((s) => s.groups);
  const trash = useNotes((s) => s.trash);
  const kind = useNotes((s) => s.storageKind);
  const where = useNotes((s) => s.storageLocation);
  const addons = useAddons((s) => s.enabled);
  const build = buildInfo();
  const env = useMemo(() => describeEnvironment(navigator.userAgent), []);
  const counts = useMemo(
    () => ({
      pages: libraryPages(pages).length,
      groups: groups.length,
      boxes: Object.values(pages).reduce((n, p) => n + p.blocks.length, 0),
      trash: trash.length,
    }),
    [pages, groups, trash],
  );
  const latest = CHANGELOG[0];

  const copy = async () => {
    const text = diagnosticsText({ build, env, storage: kind, counts, language: navigator.language, addons });
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied. It has no note text, titles or file paths, so it is safe to paste into a bug report.');
    } catch {
      toast('Couldn’t copy. Select the details above and copy them by hand.');
    }
  };

  return (
    <>
      <div className="about-head">
        <img src="/favicon.png" alt="" width={56} height={56} className="about-icon" />
        <div>
          <div className="about-name">{APP_NAME}</div>
          <div className="about-ver">
            Version {build.version}
            <span className={'chip ' + (build.mode === 'production' ? 'chip-ok' : 'chip-dev')}>{build.mode === 'production' ? 'Release build' : 'Development build'}</span>
          </div>
          <div className="about-tag">Notes on a free canvas. Private, local, no account.</div>
        </div>
      </div>

      <Section title="Version and build">
        <div className="kv kv-info">
          <span className="k">Version</span>
          <span className="v">{build.version}</span>
          <span className="k">Released</span>
          <span className="v">{formatBuildDate(latest.date)}</span>
          <span className="k">Built</span>
          <span className="v">{formatBuildDate(build.builtAt)}</span>
          <span className="k">Commit</span>
          <span className="v">{build.commit ? <code>{build.commit}</code> : 'Not recorded'}</span>
        </div>
        <p>Updates are installed by you. This app never checks for updates or contacts a server on its own.</p>
      </Section>

      <Section title="This computer">
        <div className="kv kv-info">
          <span className="k">System</span>
          <span className="v">{env.os}</span>
          <span className="k">Web engine</span>
          <span className="v">{env.engine}</span>
          <span className="k">Language</span>
          <span className="v">{navigator.language || 'Unknown'}</span>
          <span className="k">Stored</span>
          <span className="v">{kind === 'desktop' ? where : 'In this browser only (development mode)'}</span>
        </div>
      </Section>

      <Section title="Your library">
        <div className="kv kv-info">
          <span className="k">Pages</span>
          <span className="v">{counts.pages}</span>
          <span className="k">Groups</span>
          <span className="v">{counts.groups}</span>
          <span className="k">Boxes</span>
          <span className="v">{counts.boxes}</span>
          <span className="k">In Trash</span>
          <span className="v">{counts.trash}</span>
        </div>
        <p>
          <button className="btn" onClick={() => void copy()}>
            Copy diagnostics
          </button>
        </p>
      </Section>

      <Section title="What’s new">
        {CHANGELOG.map((r, i) => (
          <details key={r.version} open={i === 0} className="release">
            <summary>
              <strong>{r.version}</strong> · {r.title} <span className="muted">{formatBuildDate(r.date)}</span>
            </summary>
            <ul>
              {r.items.map((it) => (
                <li key={it}>{it}</li>
              ))}
            </ul>
          </details>
        ))}
      </Section>
    </>
  );
}
