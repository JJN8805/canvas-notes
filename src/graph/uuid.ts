// Fixed namespace for ids this app derives from content (currently: edges).
const NAMESPACE = '6f1c5a3e-2b7d-4c1a-9e55-3d0a7b8c4f21';

const hexToBytes = (hex: string) => Uint8Array.from(hex.replace(/-/g, '').match(/../g)!, (h) => parseInt(h, 16));

/** RFC 4122 version-5 UUID: the same name always gives the same id, on every device. */
export async function uuidv5(name: string, namespace = NAMESPACE): Promise<string> {
  const ns = hexToBytes(namespace);
  const nm = new TextEncoder().encode(name);
  const data = new Uint8Array(ns.length + nm.length);
  data.set(ns);
  data.set(nm, ns.length);
  const h = new Uint8Array(await crypto.subtle.digest('SHA-1', data)).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50; // version 5
  h[8] = (h[8] & 0x3f) | 0x80; // RFC 4122 variant
  const x = Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** Id of the relationship "src --type--> dst". */
export const edgeId = (src: string, dst: string, type: string) => uuidv5(`${src}|${dst}|${type}`);
