import { useEffect, useRef, useState } from 'react';
import { keys } from '../../lib/llm/transport';
import { openSettings } from '../../store/settingsUi';
import { useAiSettings } from './config';
import { b64ToFile, defaultCardPrompt, generateImageB64 } from './picture';

/**
 * "Generate with AI" for a card's picture: describe it, see it, keep it or try again. The text in the box is
 * exactly what is sent to OpenAI (nothing from the card is added), so clicking Generate is the consent.
 */
export function CardPictureDialog({ cardLabel, onPick, onClose }: { cardLabel: string; onPick: (file: File) => void; onClose: () => void }) {
  const { settings } = useAiSettings();
  const [prompt, setPrompt] = useState(() => defaultCardPrompt(cardLabel));
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [working, setWorking] = useState(false);
  const [b64, setB64] = useState('');
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void keys.has('openai').then(setHasKey, () => setHasKey(false));
    area.current?.focus();
    return () => abort.current?.abort();
  }, []);

  // Escape stops a drawing in progress, or closes the dialog. It listens on the page rather than on the dialog because the
  // buttons are disabled while drawing, which drops keyboard focus out of the dialog; and it must not also close the card behind.
  const busyRef = useRef(false);
  busyRef.current = working;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (busyRef.current) abort.current?.abort();
      else closeRef.current();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  const generate = async () => {
    if (!prompt.trim() || working) return;
    setWorking(true);
    setError('');
    const mine = (abort.current = new AbortController());
    try {
      setB64(await generateImageB64(settings, prompt, mine.signal));
    } catch (e) {
      if (!mine.signal.aborted) setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      if (abort.current === mine) abort.current = null;
      setWorking(false);
    }
  };

  const stop = () => abort.current?.abort();

  return (
    <div className="scrim" onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.target === e.currentTarget && !working && onClose()}>
      <div
        className="dialog ai-confirm"
        role="dialog"
        aria-modal="true"
        aria-label="Generate a picture with AI"
      >
        <h2>Generate a picture with AI</h2>
        {hasKey === false ? (
          <>
            <p>Pictures are drawn by OpenAI, which needs your API key. Add it in Settings → Add-ons → AI assistant (choose ChatGPT there).</p>
            <div className="row">
              <button className="btn" onClick={onClose}>Close</button>
              <button className="btn primary" onClick={() => { onClose(); openSettings(); }}>Open settings</button>
            </div>
          </>
        ) : (
          <>
            <p>Describe the picture. <strong>This text is sent to OpenAI</strong> ({settings.imageModel}) to draw it; nothing else from your notes is.</p>
            <textarea
              ref={area}
              className="field"
              rows={3}
              maxLength={1000}
              aria-label="Describe the picture"
              placeholder="e.g. a watercolour of a tomato garden at sunrise"
              value={prompt}
              disabled={working}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void generate();
                }
              }}
            />
            {working && <p className="ai-note" role="status">Drawing… this can take up to a minute.</p>}
            {error && <p className="ai-error" role="alert">{error}</p>}
            {b64 && !working && <img className="ai-img cd-gen" alt="The generated picture" src={`data:image/png;base64,${b64}`} />}
            <div className="row">
              <button className="btn" onClick={working ? stop : onClose}>{working ? 'Stop' : 'Cancel'}</button>
              <button className="btn" disabled={working || !prompt.trim() || hasKey === null} onClick={() => void generate()}>
                {b64 ? 'Try again' : 'Generate'}
              </button>
              {b64 && !working && (
                <button className="btn primary" onClick={() => { onPick(b64ToFile(b64, 'AI picture.png')); onClose(); }}>
                  Use this picture
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
