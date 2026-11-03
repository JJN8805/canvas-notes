/** Which widgets exist, remembered in the app's settings so they come back after a restart. */
import { isWidgetId, parseIndex, parseWidget, type WidgetSpec } from '../lib/widgets';

/** The slice of storage this needs (any `NotesStorage` fits). */
export interface SettingsStore {
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string | null): Promise<void>;
}

const INDEX_KEY = 'widgets.index';
const keyOf = (id: string) => `widget.${id}`;

export async function listWidgets(store: SettingsStore): Promise<WidgetSpec[]> {
  const out: WidgetSpec[] = [];
  for (const id of parseIndex(await store.getSetting(INDEX_KEY))) {
    const spec = parseWidget(await store.getSetting(keyOf(id)));
    if (spec && spec.id === id) out.push(spec);
  }
  return out;
}

export async function getWidget(store: SettingsStore, id: string): Promise<WidgetSpec | null> {
  return isWidgetId(id) ? parseWidget(await store.getSetting(keyOf(id))) : null;
}

/** Adds or replaces a widget. */
export async function saveWidget(store: SettingsStore, spec: WidgetSpec): Promise<void> {
  await store.setSetting(keyOf(spec.id), JSON.stringify(spec));
  const ids = parseIndex(await store.getSetting(INDEX_KEY));
  if (!ids.includes(spec.id)) await store.setSetting(INDEX_KEY, JSON.stringify([...ids, spec.id]));
}

export async function removeWidget(store: SettingsStore, id: string): Promise<void> {
  const ids = parseIndex(await store.getSetting(INDEX_KEY));
  await store.setSetting(INDEX_KEY, JSON.stringify(ids.filter((x) => x !== id)));
  await store.setSetting(keyOf(id), null);
}
