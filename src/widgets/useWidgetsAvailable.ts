import { useEffect, useState } from 'react';
import { widgetsAvailable, widgetsAvailableNow } from './host';

/** True in the laptop app, where widgets can be pinned. Buttons for pinning are left out everywhere else. */
export function useWidgetsAvailable(): boolean {
  const [on, setOn] = useState(widgetsAvailableNow());
  useEffect(() => {
    let live = true;
    void widgetsAvailable().then((v) => live && setOn(v));
    return () => {
      live = false;
    };
  }, []);
  return on;
}
