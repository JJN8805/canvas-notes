import { create } from 'zustand';
import type { ImageBlock } from '../../types';
import { sendRequest } from '../../lib/llm/transport';
import { getStorage, updateBlock, useNotes } from '../../store/notes';
import { toast } from '../../store/ui';
import { useOcrSettings } from './config';
import { ocrProblem, ocrRequest, parseOcrResponse } from './ocr';

/** Pictures being read right now. */
export const useOcrWork = create<{ working: string[] }>(() => ({ working: [] }));

const imageOf = (pageId: string, blockId: string): ImageBlock | null => {
  const b = useNotes.getState().pages[pageId]?.blocks.find((x) => x.id === blockId);
  return b?.type === 'image' ? b : null;
};

/** Reads one picture and keeps the text on its box. Returns the number of characters found, or throws a message for the user. */
export async function extractText(pageId: string, blockId: string): Promise<number> {
  const block = imageOf(pageId, blockId);
  if (!block) throw new Error('That picture is gone.');
  const file = block.imageId ? await getStorage().sync.readImage(block.imageId) : null;
  const problem = ocrProblem(block, file?.mime, file ? Math.floor((file.data.length * 3) / 4) : 0);
  if (problem || !file) throw new Error(problem ?? 'The picture file is missing on this device.');
  const settings = useOcrSettings.getState().settings;
  const spec = ocrRequest(settings, file.data);
  useOcrWork.setState((s) => ({ working: [...s.working, blockId] }));
  try {
    const text = parseOcrResponse(await sendRequest(spec, { model: settings.model }));
    // The box may have been deleted while the model was reading.
    if (!imageOf(pageId, blockId)) return 0;
    updateBlock<ImageBlock>(pageId, blockId, (b) => {
      if (text) b.ocr = text;
      else delete b.ocr;
    });
    return text.length;
  } finally {
    useOcrWork.setState((s) => ({ working: s.working.filter((x) => x !== blockId) }));
  }
}

const say = (n: number) => (n ? `Found ${n.toLocaleString()} characters of text.` : 'No text found in that picture.');

export async function extractWithToast(pageId: string, blockId: string) {
  if (useOcrWork.getState().working.includes(blockId)) return;
  toast('Reading the picture…', undefined, 2500);
  try {
    toast(say(await extractText(pageId, blockId)));
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Couldn’t read the picture.');
  }
}

/** Every picture on the page that has no text yet, one after another. */
export async function extractAllOnPage(pageId: string) {
  const todo = (useNotes.getState().pages[pageId]?.blocks ?? []).filter((b): b is ImageBlock => b.type === 'image' && !b.heat && !b.ocr && !!b.imageId);
  if (!todo.length) {
    toast('Every picture on this page already has its text read, or there are none.');
    return;
  }
  let found = 0;
  let skipped = 0;
  for (let i = 0; i < todo.length; i++) {
    toast(`Reading picture ${i + 1} of ${todo.length}…`, undefined, 2500);
    try {
      if ((await extractText(pageId, todo[i].id)) > 0) found++;
    } catch (e) {
      // A model or connection problem would repeat for every picture: stop and say why. A picture that can't be read is skipped.
      const m = e instanceof Error ? e.message : '';
      if (/Ollama|model|reach|address/i.test(m)) {
        toast(m);
        return;
      }
      skipped++;
    }
  }
  toast(`Read ${todo.length - skipped} picture${todo.length - skipped === 1 ? '' : 's'}; text found in ${found}.${skipped ? ` ${skipped} couldn’t be read.` : ''}`);
}
