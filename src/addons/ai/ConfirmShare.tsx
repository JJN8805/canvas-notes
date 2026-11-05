import { useEffect, useRef } from 'react';
import { SYSTEM_PROMPT } from './prompts';
import type { Message } from './chat';

export interface Pending {
  text: string;
  wire: string;
  shared?: Message['shared'];
  aliases?: Message['aliases'];
  history: string[];
}

/** What is about to go to a cloud or network model, shown in full, with a button to send it or not. */
export function ConfirmShare({ pending, to, system = SYSTEM_PROMPT, onYes, onNo }: { pending: Pending; to: string; system?: string; onYes: () => void; onNo: () => void }) {
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => yes.current?.focus(), []);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onNo()}>
      <div className="dialog ai-confirm" role="dialog" aria-modal="true" aria-label={`Send to ${to}?`} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onNo())}>
        <h2>Send this to {to}?</h2>
        <p>This is everything that will leave your computer for this message. Your notes are not sent unless they appear below.</p>
        <details>
          <summary>Instructions the app adds</summary>
          <pre className="ai-preview">{system}</pre>
        </details>
        {pending.history.length > 0 && (
          <details>
            <summary>Earlier messages in this chat ({pending.history.length}) that go along</summary>
            <pre className="ai-preview">{pending.history.join('\n\n———\n\n')}</pre>
          </details>
        )}
        <pre className="ai-preview" aria-label="The message">{pending.wire}</pre>
        <div className="row">
          <button className="btn" onClick={onNo}>Don’t send</button>
          <button ref={yes} className="btn primary" onClick={onYes}>Send to {to}</button>
        </div>
      </div>
    </div>
  );
}
