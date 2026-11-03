import { create } from 'zustand';
import { getStorage } from '../../store/notes';
import { DEFAULT_OCR, type OcrSettings } from './ocr';

const KEY = 'ocr.config';

export function cleanOcr(raw: unknown): OcrSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return { url: s(o.url, 200) || DEFAULT_OCR.url, model: s(o.model, 120) };
}

export const useOcrSettings = create<{ settings: OcrSettings; loaded: boolean }>(() => ({ settings: DEFAULT_OCR, loaded: false }));

export async function loadOcrSettings() {
  let raw: unknown = null;
  try {
    raw = JSON.parse((await getStorage().getSetting(KEY)) ?? 'null');
  } catch {
    /* defaults */
  }
  useOcrSettings.setState({ settings: cleanOcr(raw), loaded: true });
}

export function saveOcrSettings(patch: Partial<OcrSettings>) {
  const settings = cleanOcr({ ...useOcrSettings.getState().settings, ...patch });
  useOcrSettings.setState({ settings });
  void getStorage().setSetting(KEY, JSON.stringify(settings)).catch(() => {});
}
