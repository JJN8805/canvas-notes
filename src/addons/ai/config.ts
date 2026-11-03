import { create } from 'zustand';
import { DEFAULT_CONFIG, PROVIDERS, type ProviderConfig } from '../../lib/llm/providers';
import { getStorage } from '../../store/notes';
import type { ProviderId } from '../../lib/llm/types';

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
  const provider = (Object.keys(PROVIDERS) as ProviderId[]).includes(o.provider as ProviderId) ? (o.provider as ProviderId) : DEFAULT_SETTINGS.provider;
  return {
    provider,
    ollamaUrl: str(o.ollamaUrl, 200, DEFAULT_SETTINGS.ollamaUrl) || DEFAULT_SETTINGS.ollamaUrl,
    models: {
      ollama: str(m.ollama, 120, ''),
      anthropic: str(m.anthropic, 120, DEFAULT_SETTINGS.models.anthropic),
      openai: str(m.openai, 120, DEFAULT_SETTINGS.models.openai),
    },
    imageModel: str(o.imageModel, 120, DEFAULT_SETTINGS.imageModel) || DEFAULT_SETTINGS.imageModel,
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
  const settings = cleanSettings({ ...useAiSettings.getState().settings, ...patch, models: { ...useAiSettings.getState().settings.models, ...patch.models } });
  useAiSettings.setState({ settings });
  void getStorage().setSetting(KEY, JSON.stringify(settings)).catch(() => {});
}
