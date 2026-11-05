export type ProviderId = 'ollama' | 'anthropic' | 'openai' | 'gemini';

/** Everything a request can be addressed to: the three chat providers, and the two kinds of local picture server. */
export type WireProvider = ProviderId | 'sdwebui' | 'imageserver';

/** Where pictures are drawn: OpenAI or Google Gemini (cloud), a Stable Diffusion WebUI server (AUTOMATIC1111, Forge, SD.Next), or any OpenAI-compatible image server (LocalAI and others). */
export type ImageSource = 'openai' | 'gemini' | 'sdwebui' | 'imageserver';

export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

/** One HTTP request to a model provider. The API key is never in here: whoever sends it adds the key. */
export interface RequestSpec {
  provider: WireProvider;
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: string;
  /** true: the answer arrives as lines (server-sent events or NDJSON); false: one JSON document. */
  stream: boolean;
}

export type StreamEvent = { type: 'text'; text: string } | { type: 'done' } | { type: 'error'; message: string };

/** Where what is sent ends up: `local` = Ollama on this computer, `network` = Ollama elsewhere on the network, `cloud` = a company's servers. */
export type Destination = 'local' | 'network' | 'cloud';

export class LlmError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'LlmError';
  }
}
