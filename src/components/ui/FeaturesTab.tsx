import { FEATURES, PROFILES, effectiveOff, profileOf, type FeatureId } from '../../lib/features';
import { useAddons } from '../../addons/store';
import { applyProfile, setFeature, useFeatures } from '../../store/features';
import { getStorage } from '../../store/notes';
import { Section, Switch } from './SettingsParts';

const SECTIONS = ['Workspace', 'Pages', 'Tools', 'Devices'] as const;

/**
 * Settings → Features: choose what this copy of the app shows. A ready-made set (for example Word, Excel and PowerPoint only) or any mix.
 * Nothing is deleted when a feature is switched off: pages, cards and links stay and sync, and come back when it is switched on again.
 */
export function FeaturesTab() {
  const disabled = useFeatures((s) => s.disabled);
  const enabled = useAddons((s) => s.enabled);
  const workspace = enabled.includes('office');
  const current = profileOf(disabled, workspace);
  const off = effectiveOff(disabled);
  return (
    <>
      <p>Choose what the app shows. Switching something off hides it from the sidebar, menus, toolbars, shortcuts and search. Nothing is deleted, and it all comes back when you switch it on again.</p>
      <Section title="Ready-made sets">
        <div className="feature-profiles" role="radiogroup" aria-label="Ready-made sets of features">
          {PROFILES.map((p) => (
            <button key={p.id} role="radio" aria-checked={current === p.id} className={`feature-profile${current === p.id ? ' on' : ''}`} onClick={() => void applyProfile(p.id, getStorage())}>
              <strong>{p.label}</strong>
              <span>{p.description}</span>
            </button>
          ))}
        </div>
        {current === 'custom' && <p className="ai-note" role="status">Your own mix of features.</p>}
      </Section>
      {SECTIONS.map((section) => (
        <Section key={section} title={section}>
          {FEATURES.filter((f) => f.section === section).map((f) => {
            const blockedBy = !!f.needs && disabled.includes(f.needs);
            return (
              <div key={f.id} className="feature-row">
                <Switch label={f.label} on={!off.has(f.id as FeatureId)} onChange={(on) => void setFeature(f.id, on, getStorage())} />
                <p className="ai-note">
                  {f.description}
                  {blockedBy ? ` (Needs ${FEATURES.find((x) => x.id === f.needs)?.label}.)` : ''}
                </p>
              </div>
            );
          })}
          {section === 'Workspace' && !workspace && <p className="ai-note">Documents, spreadsheets and presentations need the Workspace add-on (Settings → Add-ons).</p>}
        </Section>
      ))}
    </>
  );
}
