import { addHomeWidget, useHomeWidgets, type WidgetKind } from '../../store/homeWidgets';
import { useFeature } from '../../store/features';
import { Icon, type IconName } from './Icon';

const WIDGETS: { kind: WidgetKind; icon: IconName; label: string; about: string }[] = [
  { kind: 'list', icon: 'checklist', label: 'To-do list', about: 'Tick things off and add new ones.' },
  { kind: 'capture', icon: 'edit', label: 'Quick note', about: 'Type a note for your Inbox.' },
  { kind: 'page', icon: 'pages', label: 'Page', about: 'Read one page at a glance.' },
];

/** Settings → General on an Android phone: put a widget on the home screen. */
export function HomeWidgetsSection() {
  const available = useHomeWidgets((s) => s.available);
  const on = useFeature('widgets');
  if (!available || !on) return null;
  return (
    <section className="hw-section" aria-label="Home screen widgets">
      <h3>Home screen widgets</h3>
      <p>They work while Canvas Notes is closed. What you do on them joins your notes the next time you open the app.</p>
      <div className="hw-list">
        {WIDGETS.map((w) => (
          <button key={w.kind} className="hw-add" onClick={() => void addHomeWidget(w.kind)}>
            <Icon name={w.icon} size={22} />
            <span>
              <strong>Add {w.label.toLowerCase()}</strong>
              <small>{w.about}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
