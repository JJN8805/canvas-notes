import { useAddons } from './store';

/** The floating UI of the running add-ons (see `AddOnModule.Overlay`), mounted once for the whole app. */
export function AddonOverlays() {
  const loaded = useAddons((s) => s.loaded);
  return (
    <>
      {Object.entries(loaded).map(([id, m]) => (m.Overlay ? <m.Overlay key={id} /> : null))}
    </>
  );
}
