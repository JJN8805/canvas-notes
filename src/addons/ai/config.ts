import { create } from 'zustand';
import { DEFAULT_CONFIG, IMAGE_SIZES, IMAGE_SOURCES, PROVIDERS, type ProviderConfig } from '../../lib/llm/providers';
import { getStorage } from '../../store/notes';
import type { ImageSource, ProviderId } from '../../lib/llm/types';

const KEY = 'ai.config';

export interface AiSettings extends ProviderConfig {
  /** Show what is about to be sent, and wait for a click, before a page leaves this computer. */
  confirmShare: boolean;
}

export const DEFAULT_SETTINGS: AiSettings = { ...DEFAULT_CONFIG, confirmShare: true };

const str = (v: unknown, max: number, fallback: string) => (typeof v === 'string' ? v.trim().slice(0, max) : fallback);

/** Saved settings read defensively: anything missing or odd falls back to the default. */
export function cleanSettings(raw: unknown): AiSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const m = (o.models && typeof o.models === 'object' ? o.models : {}) as Record<string, unknown>;
  const u = (o.imageUrls && typeof o.imageUrls === 'object' ? o.imageUrls : {}) as Record<string, unknown>;
  const provider = (Object.keys(PROVIDERS) as ProviderId[]).includes(o.provider as ProviderId) ? (o.provider as ProviderId) : DEFAULT_SETTINGS.provider;
  return {
    provider,
    ollamaUrl: str(o.ollamaUrl, 200, DEFAULT_SETTINGS.ollamaUrl) || DEFAULT_SETTINGS.ollamaUrl,
    models: {
      ollama: str(m.ollama, 120, ''),
      anthropic: str(m.anthropic, 120, DEFAULT_SETTINGS.models.anthropic),
      openai: str(m.openai, 120, DEFAULT_SETTINGS.models.openai),
      gemini: str(m.gemini, 120, DEFAULT_SETTINGS.models.gemini),
    },
    imageModel: str(o.imageModel, 120, DEFAULT_SETTINGS.imageModel) || DEFAULT_SETTINGS.imageModel,
    geminiImageModel: str(o.geminiImageModel, 120, DEFAULT_SETTINGS.geminiImageModel) || DEFAULT_SETTINGS.geminiImageModel,
    // Settings saved before picture sources existed have none of these: pictures keep coming from OpenAI.
    imageSource: (Object.keys(IMAGE_SOURCES) as ImageSource[]).includes(o.imageSource as ImageSource) ? (o.imageSource as ImageSource) : DEFAULT_SETTINGS.imageSource,
    imageUrls: {
      sdwebui: str(u.sdwebui, 200, '') || DEFAULT_SETTINGS.imageUrls.sdwebui,
      imageserver: str(u.imageserver, 200, '') || DEFAULT_SETTINGS.imageUrls.imageserver,
    },
    imageServerModel: str(o.imageServerModel, 200, ''),
    imageSize: (IMAGE_SIZES as readonly number[]).includes(Number(o.imageSize)) ? Number(o.imageSize) : DEFAULT_SETTINGS.imageSize,
    imageSteps: typeof o.imageSteps === 'number' && Number.isFinite(o.imageSteps) ? Math.min(150, Math.max(1, Math.round(o.imageSteps))) : DEFAULT_SETTINGS.imageSteps,
    confirmShare: o.confirmShare !== false,
  };
}

interface ConfigStore {
  settings: AiSettings;
  loaded: boolean;
}

export const useAiSettings = create<ConfigStore>(() => ({ settings: DEFAULT_SETTINGS, loaded: false }));

export async function loadAiSettings() {
  let raw: unknown = null;
  try {
    raw = JSON.parse((await getStorage().getSetting(KEY)) ?? 'null');
  } catch {
    /* start from the defaults */
  }
  useAiSettings.setState({ settings: cleanSettings(raw), loaded: true });
}

export function saveAiSettings(patch: Partial<AiSettings>) {
  const cur = useAiSettings.getState().settings;
  const settings = cleanSettings({ ...cur, ...patch, models: { ...cur.models, ...patch.models }, imageUrls: { ...cur.imageUrls, ...patch.imageUrls } });
  useAiSettings.setState({ settings });
  void getStorage().setSetting(KEY, JSON.stringify(settings)).catch(() => {});
}
