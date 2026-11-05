// Loaded lazily (see DrawOverlay): this file and Excalidraw only reach the browser when draw mode is first opened.
import '@excalidraw/excalidraw/index.css';
import { useEffect, useRef } from 'react';
import { Excalidraw, exportToSvg, getCommonBounds, getSceneVersion } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { PageDrawing } from '../../types';
import { sceneElements, toolToLock } from '../../lib/drawing';

type Elements = readonly Record<string, unknown>[];

/** Space kept around the strokes in the SVG render so thick lines aren't clipped. */
const PAD = 16;

export const parseScene = (scene: string): Elements => sceneElements(scene);

/** The drawing for these strokes (null when there are none). Its box is in the canvas's own coordinates. */
export async function toPageDrawing(elements: Elements): Promise<PageDrawing | null> {
  if (!elements.length) return null;
  const [minX, minY, maxX, maxY] = getCommonBounds(elements as never);
  const svg = await exportToSvg({
    elements: elements as never,
    appState: { exportBackground: false },
    files: null,
    exportPadding: PAD,
  });
  return {
    scene: JSON.stringify({ elements }),
    preview: svg.outerHTML,
    x: Math.floor(minX - PAD),
    y: Math.floor(minY - PAD),
    w: Math.ceil(maxX - minX + PAD * 2),
    h: Math.ceil(maxY - minY + PAD * 2),
  };
}

export interface DrawView {
  /** Excalidraw's own scroll offsets: the canvas is at screen = (point + scroll) * zoom. */
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export interface DrawHandle {
  setView(view: DrawView): void;
}

export default function DrawEditor({
  scene,
  view,
  dark,
  onChange,
  onView,
  onReady,
}: {
  scene: string;
  view: DrawView;
  dark: boolean;
  onChange: (drawing: PageDrawing | null) => void;
  onView: (view: DrawView) => void;
  onReady: (handle: DrawHandle) => void;
}) {
  const initial = useRef({ elements: parseScene(scene), view });
  const timer = useRef<number | null>(null);
  const version = useRef(getSceneVersion(initial.current.elements as never));
  const latest = useRef<Elements | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const lastTool = useRef('selection');
  const onViewRef = useRef(onView);
  onViewRef.current = onView;

  const commit = async () => {
    const elements = latest.current;
    latest.current = null;
    if (elements) onChangeRef.current(await toPageDrawing(elements));
  };

  // Whatever is still waiting when draw mode closes is saved too.
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      void commit();
    },
    [],
  );

  const ready = (a: ExcalidrawImperativeAPI) => {
    api.current = a;
    onReady({
      setView: (v) => a.updateScene({ appState: { scrollX: v.scrollX, scrollY: v.scrollY, zoom: { value: v.zoom as never } } }),
    });
  };

  return (
    <Excalidraw
      excalidrawAPI={ready}
      initialData={{
        elements: initial.current.elements as never,
        appState: {
          viewBackgroundColor: 'transparent',
          scrollX: initial.current.view.scrollX,
          scrollY: initial.current.view.scrollY,
          zoom: { value: initial.current.view.zoom as never },
        },
      }}
      theme={dark ? 'dark' : 'light'}
      handleKeyboardGlobally={false}
      detectScroll={false}
      UIOptions={{
        canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: false, changeViewBackgroundColor: false },
        tools: { image: false },
      }}
      onScrollChange={(scrollX, scrollY, zoom) => onViewRef.current({ scrollX, scrollY, zoom: zoom.value })}
      onChange={(all, appState) => {
        // A tool stays selected until you pick another: Excalidraw would drop back to the pointer after each stroke.
        const tool = appState.activeTool;
        const lock = toolToLock(lastTool.current, tool);
        lastTool.current = tool.type;
        if (lock) api.current?.setActiveTool({ type: lock as 'freedraw', locked: true });
        // Panning and zooming also arrive here; only a change to the strokes is worth saving.
        const v = getSceneVersion(all);
        if (v === version.current) return;
        version.current = v;
        latest.current = all.filter((e) => !e.isDeleted) as never;
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => void commit(), 700);
      }}
    />
  );
}
