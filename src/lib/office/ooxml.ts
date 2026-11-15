/**
 * A small XML reader for the parts of Word and Excel files this app reads (pure, no DOM, so it runs in tests too). It handles elements,
 * attributes, text, entities, CDATA, comments and processing instructions; it does not resolve external entities or DTDs (a file that
 * uses them is read as text and the declarations are ignored), and it stops at a depth and size limit rather than trusting the file.
 */
export interface XNode {
  name: string;
  attrs: Record<string, string>;
  children: XNode[];
  text: string;
}

const MAX_DEPTH = 200;
const MAX_NODES = 2_000_000;
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return ENT[e] ?? m;
  });

/** The local name of an element or attribute: `w:p` → `p`. */
export const local = (name: string) => name.slice(name.indexOf(':') + 1);

export function parseXml(xml: string): XNode {
  const root: XNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XNode[] = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<(\/?)([^\s/>!?]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
  let nodes = 0;
  for (const m of xml.matchAll(re)) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[6] !== undefined) top.text += decode(m[6]);
    else if (m[3] !== undefined) {
      if (m[2]) {
        if (stack.length > 1) stack.pop(); // a closing tag
      } else {
        if (++nodes > MAX_NODES || stack.length > MAX_DEPTH) throw new Error('That file is too large or too deeply nested to read.');
        const attrs: Record<string, string> = {};
        for (const a of m[4].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[local(a[1])] = decode(a[2] ?? a[3] ?? '');
        const node: XNode = { name: local(m[3]), attrs, children: [], text: '' };
        top.children.push(node);
        if (!m[5]) stack.push(node);
      }
    }
  }
  return root.children[0] ?? root;
}

export const child = (n: XNode | undefined, name: string): XNode | undefined => n?.children.find((c) => c.name === name);
export const kids = (n: XNode | undefined, name: string): XNode[] => n?.children.filter((c) => c.name === name) ?? [];
/** All the text inside a node, in order. */
export const textOf = (n: XNode): string => n.text + n.children.map(textOf).join('');
