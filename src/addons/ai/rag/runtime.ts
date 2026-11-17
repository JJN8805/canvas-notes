/**
 * The running index: wires the pure pieces to the app (the real pages, settings, database and transport). Started once by the AI add-on.
 * It indexes in the background a few seconds after the app opens and a few seconds after pages change, and only while the AI add-on is on.
 */
import { libraryPages } from '../../../lib/pages';
import { useNotes, getStorage } from '../../../store/notes';
import { useAddons } from '../../store';
import { passagesOf } from '../notesSearch';
import { embedTexts } from './client';
import { cleanRag, loadRagSettings, ragReady, useRagSettings, type Ready } from './config';
import { createIndexer } from './indexer';
import { ragIndex } from './memory';
import { retrieveNotes, type Retrieved } from './retrieve';
import { setRagStatus, useRagStatus } from './status';

const aiOn = () => useAddons.getState().enabled.includes('ai');
const settings = () => useRagSettings.getState().settings;
const ready = (): Ready => (aiOn() ? ragReady(settings()) : { ok: false, reason: 'off' });
const currentPassages = () => passagesOf(libraryPages(useNotes.getState().pages));

const indexer = createIndexer({
  passages: currentPassages,
  ready,
  embedConfig: () => settings().embed,
  store: () => getStorage().vectors,
  index: ragIndex,
  embed: embedTexts,
  report: setRagStatus,
  alive: aiOn,
});

let started = false;
let timer: number | null = null;

/** Index soon (several changes in a row become one run). */
export function indexSoon(ms = 5000) {
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    void indexer.run();
  }, ms);
}

export const indexNow = () => indexer.run();
export const rebuildIndex = () => indexer.rebuild();

/** Starts keeping the index current. Safe to call more than once. */
export function startRag() {
  if (started) return;
  started = true;
  void loadRagSettings().then(() => indexSoon(3000));
  let last = JSON.stringify(settings());
  useRagSettings.subscribe((s) => {
    const next = JSON.stringify(s.settings);
    if (next === last) return;
    last = next;
    indexSoon(500); // a different model, address or switch: look again at once
  });
  useNotes.subscribe((s, prev) => {
    if (s.pages !== prev.pages && ready().ok) indexSoon();
  });
  // The add-on was switched on after start-up, or the index was empty when the first search came: any change of the add-on list looks again.
  useAddons.subscribe((s, prev) => {
    if (s.enabled !== prev.enabled) indexSoon(500);
  });
}

/** The passages of the person's notes that bear on a question, by meaning and words. `except` leaves out pages (the one already attached). */
export async function retrieveForQuestion(question: string, opts: { except?: readonly string[]; signal?: AbortSignal } = {}): Promise<Retrieved> {
  const skip = new Set(opts.except ?? []);
  const passages = currentPassages().filter((p) => !skip.has(p.pageId));
  return retrieveNotes(question, passages, { ready, embedConfig: () => settings().embed, embed: embedTexts, index: ragIndex }, { signal: opts.signal });
}

export { useRagStatus, cleanRag };
