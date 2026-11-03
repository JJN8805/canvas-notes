import type { Destination, ProviderId } from './types';

/** "localhost:11434" → "http://localhost:11434". Returns null for anything that isn't an http(s) address. */
export function normalizeBaseUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `http://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null; // credentials in a URL would end up in logs and settings
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
}

/** True for localhost, 127.x.x.x and ::1: addresses that never leave this computer. */
export function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h);
}

export function destinationOf(provider: ProviderId, ollamaUrl: string): Destination {
  if (provider !== 'ollama') return 'cloud';
  const base = normalizeBaseUrl(ollamaUrl);
  if (!base) return 'network';
  return isLoopbackHost(new URL(base).hostname) ? 'local' : 'network';
}
