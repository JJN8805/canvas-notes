/** Recording from the microphone with the webview's MediaRecorder. Whether the webview allows it is up to the platform, so every step reports a readable failure. */

import { isTauri } from '../storage';

/** Formats to try, best first: what the webview can record decides. */
const CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

/**
 * Whether to offer recording. The Linux desktop app's window (WebKitGTK) refuses microphone access outright
 * (checked on a real build: getUserMedia fails with NotAllowedError and no system setting changes that), so the button
 * is left out there rather than shown and failing. Windows, macOS and Android have not been checked.
 */
export const canRecord = (): boolean => {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return false;
  const linuxDesktopApp = isTauri() && /Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent);
  return !linuxDesktopApp;
};

export interface Recording {
  /** Ends the recording and gives the audio. */
  stop(): Promise<Blob>;
  /** Ends it and throws the audio away. */
  cancel(): void;
}

function explain(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone access was blocked. Check that this window is allowed to use the microphone, or add an audio file instead.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found.';
  if (name === 'NotReadableError') return 'The microphone is in use by another program.';
  return e instanceof Error && e.message ? e.message : 'Recording isn’t available here.';
}

export async function startRecording(): Promise<Recording> {
  if (!canRecord()) throw new Error('Recording isn’t available in this window. Add an audio file instead.');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    throw new Error(explain(e));
  }
  const release = () => stream.getTracks().forEach((t) => t.stop());
  try {
    const type = CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t));
    const rec = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    let finished: Promise<Blob> | null = null;
    const end = () =>
      (finished ??= new Promise<Blob>((resolve, reject) => {
        rec.onstop = () => {
          release();
          resolve(new Blob(chunks, { type: rec.mimeType || type || 'audio/webm' }));
        };
        rec.onerror = () => {
          release();
          reject(new Error('The recording failed.'));
        };
        if (rec.state === 'inactive') rec.onstop(new Event('stop'));
        else rec.stop();
      }));
    rec.start(1000);
    return { stop: end, cancel: () => void end().catch(() => {}) };
  } catch (e) {
    release();
    throw new Error(explain(e));
  }
}
