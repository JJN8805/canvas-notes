import { useCallback, useEffect, useState } from 'react';
import type { WidgetSpec } from '../../lib/widgets';
import { BLOCK_LABEL } from '../../lib/util';
import { useNotes } from '../../store/notes';
import { toast } from '../../store/ui';
import { pinnedWidgets, unpinWidget } from '../../widgets';
import { autostartEnabled, openWidgetWindow, setAutostart } from '../../widgets/host';
import { useWidgetsAvailable } from '../../widgets/useWidgetsAvailable';
import { Section, Switch } from './SettingsParts';

/** Settings for desktop widgets: start with the laptop, and the list of what is pinned. */
export function DesktopTab() {
  const available = useWidgetsAvailable();
  const pages = useNotes((s) => s.pages);
  const [login, setLogin] = useState<boolean | null>(null);
  const [widgets, setWidgets] = useState<WidgetSpec[]>([]);

  const reload = useCallback(() => void pinnedWidgets().then(setWidgets).catch(() => setWidgets([])), []);
  useEffect(() => {
    if (!available) return;
    reload();
    void autostartEnabled().then(setLogin).catch(() => setLogin(false));
  }, [available, reload]);

  if (!available) {
    return (
      <Section title="Desktop widgets">
        <p>Pin a box or a page to your desktop from the laptop app. This is the phone app or a browser, so there is nothing to set here.</p>
      </Section>
    );
  }

  const label = (w: WidgetSpec) => {
    const page = pages[w.pageId];
    if (!page) return 'Deleted page';
    const name = page.title.trim() || 'Untitled';
    const block = w.blockId ? page.blocks.find((b) => b.id === w.blockId) : null;
    return w.blockId ? `${name} · ${block ? BLOCK_LABEL[block.type] : 'missing box'}` : name;
  };

  return (
    <>
      <Section title="Start with the laptop">
        <Switch
          label="Show my widgets when I log in (runs in the tray)"
          on={!!login}
          onChange={(on) => {
            setLogin(on);
            void setAutostart(on).catch((e) => {
              setLogin(!on);
              toast(`Couldn’t change it: ${e instanceof Error ? e.message : e}`);
            });
          }}
        />
        <p>
          Canvas Notes starts hidden with an icon in the system tray, and your widgets appear on the desktop. Closing the main window keeps it running there; choose Quit from the tray icon to stop it.
        </p>
      </Section>
      <Section title="Widgets on my desktop">
        {widgets.length === 0 ? (
          <p>Nothing pinned yet. Use the pin button in a box’s bar, Pin to desktop in a page’s menu, or select several boxes and choose Pin to desktop.</p>
        ) : (
          <ul className="widget-list">
            {widgets.map((w) => (
              <li key={w.id}>
                <span className="widget-list-name">{label(w)}</span>
                <button className="btn small" onClick={() => void openWidgetWindow(w).catch((e) => toast(String(e)))}>Show</button>
                <button className="btn small" onClick={() => void unpinWidget(w.id).then(reload)}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        <p>On some Linux desktops (such as Wayland) a widget can’t stay behind other windows; use the layer button on the widget to float it above them instead.</p>
      </Section>
    </>
  );
}
