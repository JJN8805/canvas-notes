import { ADDONS } from '../../addons/registry';
import { setAddonEnabled, useAddons } from '../../addons/store';
import { getStorage } from '../../store/notes';
import { Section, Switch } from './SettingsParts';

/** Settings → Add-ons: optional features that are only loaded while switched on, each with its own settings. */
export function AddonsTab() {
  const { enabled, loaded, loading, errors } = useAddons();
  return (
    <>
      <p>Add-ons are optional extras. One that is switched off is not even loaded: it does nothing and makes no network requests.</p>
      {ADDONS.map((a) => {
        const on = enabled.includes(a.id);
        const mod = loaded[a.id];
        return (
          <Section key={a.id} title={a.name}>
            <p>{a.description}</p>
            <p className="ai-note"><strong>Privacy:</strong> {a.privacy}</p>
            <Switch label={`Turn on ${a.name}`} on={on} onChange={(v) => void setAddonEnabled(a.id, v, getStorage())} />
            {on && loading.includes(a.id) && <p className="ai-note" role="status">Loading…</p>}
            {on && errors[a.id] && <p className="ai-note dest-network" role="alert">It couldn’t start: {errors[a.id]}</p>}
            {on && mod && <mod.Settings />}
          </Section>
        );
      })}
    </>
  );
}
