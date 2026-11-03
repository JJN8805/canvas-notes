/** Turns an assistant's Markdown answer into the HTML a text box holds. Everything is escaped first, so an answer can't add markup of its own. */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** **bold**, *italic*, `code`, and [text](url) shown as "text (url)". Input must already be escaped. */
function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)');
}

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  const flushPara: string[] = [];
  const para = () => {
    if (flushPara.length) out.push(`<p>${inline(esc(flushPara.join(' ')))}</p>`);
    flushPara.length = 0;
  };
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*```/);
    if (fence) {
      para();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i++; // the closing fence (or the end)
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      para();
      out.push(`<h${Math.min(h[1].length, 3)}>${inline(esc(h[2]))}</h${Math.min(h[1].length, 3)}>`);
      i++;
      continue;
    }
    const ul = line.match(/^\s*[-*+]\s+(?:\[( |x|X)\]\s+)?(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      para();
      const tag = ul ? 'ul' : 'ol';
      const items: string[] = [];
      while (i < lines.length) {
        const m = tag === 'ul' ? lines[i].match(/^\s*[-*+]\s+(?:\[( |x|X)\]\s+)?(.*)$/) : lines[i].match(/^\s*\d+[.)]\s+(.*)$/);
        if (!m) break;
        // A task-list marker ("- [ ] item") becomes plain text: the item text, with a check mark when ticked.
        const text = tag === 'ul' ? (m[1] && m[1] !== ' ' ? '✓ ' : '') + m[2] : m[1];
        items.push(`<li><p>${inline(esc(text))}</p></li>`);
        i++;
      }
      out.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }
    if (!line.trim()) {
      para();
      i++;
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    flushPara.push((quote ? quote[1] : line).trim());
    i++;
  }
  para();
  return out.join('');
}

/** The plain checklist lines ("- [ ] task") in an answer, for turning it into a checklist box. */
export function checklistItems(md: string): string[] {
  return md.split(/\r?\n/).map((l) => l.match(/^\s*[-*+]\s+\[[ xX]\]\s+(.*\S)\s*$/)?.[1]).filter((t): t is string => !!t);
}
