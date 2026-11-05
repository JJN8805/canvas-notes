import type { AddOnId, AddOnInfo } from './types';

/**
 * Every add-on the app knows about. `load` is a dynamic import, so an add-on's code is not even downloaded
 * (or run) until it is switched on; nothing here makes a network request.
 */
export const ADDONS: readonly AddOnInfo[] = [
  {
    id: 'ai',
    name: 'AI assistant',
    description: 'A chat panel that can read the page you choose, write reports and checklists, and insert answers (and generated pictures) onto the page. Works with Ollama on this computer, or with Claude or OpenAI using your own API key. Pictures can be drawn by OpenAI or by an open-source model on your own computer (a Stable Diffusion WebUI or OpenAI-compatible image server).',
    privacy: 'With Ollama on this computer nothing leaves it. Claude and OpenAI send what you choose to share (shown to you first) to their servers. A picture description goes only to the picture source you choose; a server on this computer keeps it here. Chats are not saved.',
    load: () => import('./ai').then((m) => m.default),
  },
  {
    id: 'ocr',
    name: 'Text from pictures (OCR)',
    description: 'Reads the text in a picture with a vision model, so it can be found by search. Adds an “Extract text” button to picture boxes.',
    privacy: 'Pictures are sent only to Ollama on this computer, never anywhere else.',
    load: () => import('./ocr').then((m) => m.default),
  },
];

export const isAddOnId = (v: unknown): v is AddOnId => ADDONS.some((a) => a.id === v);
