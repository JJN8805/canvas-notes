export type ProviderId = 'ollama' | 'anthropic' | 'openai';

export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

/** One HTTP request to a model provider. The API key is never in here: whoever sends it adds the key. */
export interface RequestSpec {
  provider: ProviderId;
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
