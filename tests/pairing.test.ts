import { describe, expect, it } from 'vitest';
import qrcode from 'qrcode-generator';
import { pairingLink, parsePairing } from '../src/lib/pairing';

const CODE = 'ABCD-EFGH-JKLM-NPQR-STUV';

describe('the pairing link', () => {
  it('round-trips an address and a code', () => {
    const link = pairingLink('192.168.1.20', CODE);
    expect(link).toBe(`canvasnotes://pair?a=192.168.1.20&c=${CODE}`);
    expect(parsePairing(link)).toEqual({ address: '192.168.1.20', code: CODE });
  });
  it('is read from a pasted link even with spaces around it, in any case', () => {
    expect(parsePairing(`  CANVASNOTES://pair?a=10.0.0.5&c=${CODE.toLowerCase()}\n`)).toEqual({ address: '10.0.0.5', code: CODE });
  });
  it('is read from an address and a code written next to each other', () => {
    for (const t of [`10.0.0.5 ${CODE}`, `10.0.0.5, ${CODE}`, `10.0.0.5\n${CODE}`, `10.0.0.5\t${CODE.toLowerCase()}`]) expect(parsePairing(t)).toEqual({ address: '10.0.0.5', code: CODE });
  });
  it('knows hostnames and IPv6 addresses too', () => {
    expect(parsePairing(pairingLink('laptop.local', CODE))?.address).toBe('laptop.local');
    expect(parsePairing(pairingLink('[fe80::1]', CODE))?.address).toBe('[fe80::1]');
  });
  it('refuses what is not a pairing (or not safe to use as an address)', () => {
    for (const bad of ['', '   ', 'hello', '10.0.0.5', `10.0.0.5 ${CODE} extra`, 'canvasnotes://pair?a=10.0.0.5', `canvasnotes://pair?c=${CODE}`, `canvasnotes://pair?a=${encodeURIComponent('a b/../x')}&c=${CODE}`, `canvasnotes://pair?a=10.0.0.5&c=short`, `canvasnotes://pair?a=${encodeURIComponent('<script>')}&c=${CODE}`, `javascript://pair?a=1&c=${CODE}`]) expect(parsePairing(bad), bad).toBeNull();
  });
});

describe('the QR code of the link', () => {
  it('fits the longest link in a QR code the library can draw', () => {
    const link = pairingLink('192.168.100.200', CODE);
    const qr = qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    expect(qr.getModuleCount()).toBeGreaterThan(20);
    expect(qr.createDataURL(4)).toMatch(/^data:image\/gif;base64,/);
  });
});
