// Loaded lazily (see DrawOverlay): this file and Excalidraw only reach the browser when a drawing is opened.
import './excalidrawAssets';
import '@excalidraw/excalidraw/index.css';
import { useEffect, useRef } from 'react';
import { Excalidraw, exportToSvg } from '@excalidraw/excalidraw';

interface Scene {
  elements: readonly Record<string, unknown>[];
  background?: string;
}

function parse(scene: string): Scene {
  try {
    const s = JSON.parse(scene) as Scene;
    return Array.isArray(s.elements) ? s : { elements: [] };
  } catch {
    return { elements: [] };
  }
}

export default function DrawEditor({ scene, onChange }: { scene: string; onChange: (scene: string, preview: string) => void }) {
  const initial = useRef(parse(scene));
  const timer = useRef<number | null>(null);
  const latest = useRef<{ elements: Scene['elements']; background: string } | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const commit = async () => {
    const cur = latest.current;
    latest.current = null;
    if (!cur) return;
    if (!cur.elements.length) return onChangeRef.current('', '');
    const svg = await exportToSvg({
      elements: cur.elements as never,
      appState: { exportBackground: true, viewBackgroundColor: cur.background },
      files: null,
      exportPadding: 12,
    });
    onChangeRef.current(JSON.stringify({ elements: cur.elements, background: cur.background } satisfies Scene), svg.outerHTML);
  };

  // Whatever is still waiting when the editor closes is saved too.
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      void commit();
    },
    [],
  );

  return (
    <Excalidraw
      initialData={{
        elements: initial.current.elements as never,
        appState: { viewBackgroundColor: initial.current.background ?? '#ffffff' },
        scrollToContent: true,
      }}
      theme="light"
      handleKeyboardGlobally={false}
      detectScroll={false}
      UIOptions={{
        canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: false },
        tools: { image: false },
      }}
      onChange={(elements, appState) => {
        latest.current = { elements: elements.filter((e) => !e.isDeleted) as never, background: appState.viewBackgroundColor };
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => void commit(), 700);
      }}
    />
  );
}
