/**
 * One "pairing link" instead of an address and a code to type: `canvasnotes://pair?a=192.168.1.20&c=ABCD-…`. The laptop shows it (as text
 * and a QR code); the phone takes it pasted into either field. Pure. The code is the secret that keys the encryption, so the link is as
 * private as the code: it is only ever shown on the laptop's own screen and copied by the person.
 */
export interface Pairing {
  address: string;
  code: string;
}

const ADDRESS = /^[A-Za-z0-9.\-:\[\]]{1,80}$/;
const CODE = /^[A-Za-z0-9-]{8,64}$/;

/** The link for an address and code. */
export const pairingLink = (address: string, code: string): string => `canvasnotes://pair?a=${encodeURIComponent(address.trim())}&c=${encodeURIComponent(code.trim())}`;

/**
 * What a pasted text means, or null when it is not a pairing. Takes the link, or an address and a code separated by spaces, a comma or a
 * line break ("192.168.1.20  ABCD-EFGH-…"). The code is upper-cased, the way the phone's field does.
 */
export function parsePairing(text: string): Pairing | null {
  const t = text.trim();
  if (!t) return null;
  let address = '';
  let code = '';
  const link = /^canvasnotes:\/\/pair\?(.*)$/i.exec(t);
  if (link) {
    const q = new URLSearchParams(link[1]);
    address = q.get('a') ?? '';
    code = q.get('c') ?? '';
  } else {
    const parts = t.split(/[\s,;]+/).filter(Boolean);
    if (parts.length !== 2) return null;
    [address, code] = parts;
  }
  address = address.trim();
  code = code.trim().toUpperCase();
  return ADDRESS.test(address) && CODE.test(code) ? { address, code } : null;
}
