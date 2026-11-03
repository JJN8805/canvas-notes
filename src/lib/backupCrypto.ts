/**
 * Passphrase-protected backups. The backup JSON is encrypted with AES-256-GCM under a key made from the
 * passphrase with PBKDF2-SHA256 (WebCrypto, so nothing leaves the device and no extra library is needed).
 * The passphrase is never stored: lose it and the backup cannot be opened by anyone, including us.
 */
const FORMAT = 'canvas-notes-encrypted-backup';
const ITERATIONS = 600_000;
/** Refuse absurd values in a file we didn't write: it would freeze the app while "deriving a key". */
const MAX_ITERATIONS = 5_000_000;

interface Envelope {
  format: typeof FORMAT;
  version: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  /** base64 */
  salt: string;
  iv: string;
  data: string;
}

const b64 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFor(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** True when the text is one of our encrypted backups (so the app knows to ask for the passphrase). */
export function isEncryptedBackup(text: string): boolean {
  try {
    return JSON.parse(text)?.format === FORMAT;
  } catch {
    return false;
  }
}

/** The encrypted file's text for a backup's JSON text. */
export async function encryptBackupText(plain: string, passphrase: string): Promise<string> {
  if (!passphrase) throw new Error('Choose a passphrase.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(passphrase, salt, ITERATIONS);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)));
  const env: Envelope = { format: FORMAT, version: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), data: b64(data) };
  return JSON.stringify(env);
}

/** The backup's JSON text. Throws a message fit to show when the passphrase is wrong or the file is damaged. */
export async function decryptBackupText(fileText: string, passphrase: string): Promise<string> {
  let env: Partial<Envelope>;
  try {
    env = JSON.parse(fileText);
  } catch {
    throw new Error('That file isn’t a Canvas Notes backup.');
  }
  if (env?.format !== FORMAT) throw new Error('That file isn’t an encrypted Canvas Notes backup.');
  if (env.version !== 1 || env.kdf !== 'PBKDF2-SHA256') throw new Error('That backup was made by a newer version of Canvas Notes. Update the app and try again.');
  const iterations = Number(env.iterations);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) throw new Error('That backup file is damaged.');
  try {
    const key = await keyFor(passphrase, unb64(env.salt ?? ''), iterations);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv ?? '') }, key, unb64(env.data ?? ''));
    return new TextDecoder().decode(plain);
  } catch {
    // GCM can't tell a wrong passphrase from a changed file; say both.
    throw new Error('Wrong passphrase, or the backup file is damaged.');
  }
}
