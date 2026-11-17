/**
 * Settings for searching notes by meaning. Kept apart from the chat settings (their own `ai.rag` setting).
 *
 * Privacy: by default embeddings are made by Ollama on this computer, so nothing leaves it. A cloud source (OpenAI, Gemini) sends the
 * text of EVERY page that is indexed, and every question that is searched, to that company. It therefore does nothing until the person has
 * turned it on in Settings and agreed to exactly that (`cloudConsent`), and the agreement is forgotten when they switch away from it.
 */
import { create } from 'zustand';
import { getStorage } from '../../../store/notes';
import { DEFAULT_EMBED_CONFIG, EMBED_SOURCES, embedModelId, isCloudEmbedding, type EmbedConfig, type EmbedSource } from './embedApi';

const KEY = 'ai.rag';

export interface RagSettings {
  /** Search by meaning as well as by words. */
  semantic: boolean;
  embed: EmbedConfig;
  /** The cloud source the person has agreed to send their notes to for indexing, or null. Never set for the local source. */
  cloudConsent: EmbedSource | null;
  /** The assistant's chat drawer starts with "Also search my other notes" on. */
  assistantNotes: boolean;
  /** "Write with AI" may use related passages of other pages as reference. */
  inlineNotes: boolean;
}

export const DEFAULT_RAG: RagSettings = { semantic: true, embed: DEFAULT_EMBED_CONFIG, cloudConsent: null, assistantNotes: false, inlineNotes: false };

const str = (v: unknown, max: number, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback);

/** Saved settings read defensively. A cloud source without the agreement is put back to the local one: it must never run by accident. */
export function cleanRag(raw: unknown): RagSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const e = (o.embed && typeof o.embed === 'object' ? o.embed : {}) as Record<string, unknown>;
  const m = (e.models && typeof e.models === 'object' ? e.models : {}) as Record<string, unknown>;
  const sources = Object.keys(EMBED_SOURCES) as EmbedSource[];
  let source: EmbedSource = sources.includes(e.source as EmbedSource) ? (e.source as EmbedSource) : 'local';
  const consent = sources.includes(o.cloudConsent as EmbedSource) && isCloudEmbedding(o.cloudConsent as EmbedSource) ? (o.cloudConsent as EmbedSource) : null;
  if (isCloudEmbedding(source) && consent !== source) source = 'local';
  return {
    semantic: o.semantic !== false,
    embed: {
      source,
      ollamaUrl: str(e.ollamaUrl, 200, DEFAULT_EMBED_CONFIG.ollamaUrl),
      models: { local: str(m.local, 120, DEFAULT_EMBED_CONFIG.models.local), openai: str(m.openai, 120, DEFAULT_EMBED_CONFIG.models.openai), gemini: str(m.gemini, 120, DEFAULT_EMBED_CONFIG.models.gemini) },
    },
    cloudConsent: consent && consent === source ? consent : null,
    assistantNotes: o.assistantNotes === true,
    inlineNotes: o.inlineNotes === true,
  };
}

export type Ready = { ok: true; model: string } | { ok: false; reason: 'off' | 'no-model' };

/** Whether notes can be searched by meaning right now, and with which model. */
export function ragReady(s: RagSettings): Ready {
  if (!s.semantic) return { ok: false, reason: 'off' };
  if (isCloudEmbedding(s.embed.source) && s.cloudConsent !== s.embed.source) return { ok: false, reason: 'off' };
  if (!s.embed.models[s.embed.source].trim()) return { ok: false, reason: 'no-model' };
  return { ok: true, model: embedModelId(s.embed) };
}

export const useRagSettings = create<{ settings: RagSettings; loaded: boolean }>(() => ({ settings: DEFAULT_RAG, loaded: false }));

export async function loadRagSettings() {
  let raw: unknown = null;
  try {
    raw = JSON.parse((await getStorage().getSetting(KEY)) ?? 'null');
  } catch {
    /* defaults */
  }
  useRagSettings.setState({ settings: cleanRag(raw), loaded: true });
}

/** Changes settings. Switching away from a cloud source forgets the agreement to use it. */
export function saveRag(patch: Partial<Omit<RagSettings, 'embed'>> & { embed?: Partial<EmbedConfig> }) {
  const cur = useRagSettings.getState().settings;
  const embed: EmbedConfig = { ...cur.embed, ...patch.embed, models: { ...cur.embed.models, ...patch.embed?.models } };
  const next = { ...cur, ...patch, embed };
  if (patch.embed?.source && patch.embed.source !== cur.embed.source && cur.cloudConsent !== patch.embed.source) next.cloudConsent = null;
  const settings = cleanRag(next);
  useRagSettings.setState({ settings });
  void getStorage().setSetting(KEY, JSON.stringify(settings)).catch(() => {});
}

/** The person has read what a cloud source receives and agreed: only now can that source run. */
export function agreeToCloudEmbedding(source: EmbedSource) {
  if (!isCloudEmbedding(source)) return;
  const cur = useRagSettings.getState().settings;
  const next = cleanRag({ ...cur, embed: { ...cur.embed, source }, cloudConsent: source });
  useRagSettings.setState({ settings: next });
  void getStorage().setSetting(KEY, JSON.stringify(next)).catch(() => {});
}
