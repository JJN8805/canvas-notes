/**
 * The small Markdown that the page export writes (headings, paragraphs, bold/italic/code, links, images, lists with ticks, quotes, tables,
 * fenced code) turned into HTML for a published site. Pure and safe by construction: every piece of text is escaped first, tags are only
 * ever made by this file, and a link or picture address is let through only when it is a plain relative path, http(s) or mailto.
 */
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c]);

/** An address that is safe to put in href/src: relative (no scheme), http(s), or mailto. Anything else (javascript:, data:, file:…) becomes '#'. */
export function safeUrl(u: string): string {
  const url = u.trim();
  if (/^(https?:|mailto:)/i.test(url)) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) return '#';
  return url;
}

/** Inline formatting inside one line of text. */
export function inline(text: string): string {
  const parts: string[] = [];
  const stash = (html: string) => `\u0000${parts.push(html) - 1}\u0000`;
  let s = text.replace(/`([^`]+)`/g, (_m, code: string) => stash(`<code>${esc(code)}</code>`));
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt: string, url: string) => stash(`<img src="${esc(safeUrl(url))}" alt="${esc(alt)}" loading="lazy">`));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => stash(`<a href="${esc(safeUrl(url))}">${esc(label)}</a>`));
  s = esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => parts[Number(i)]);
}

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isTableRule = (l: string) => /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const listItem = (l: string) => /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(l);

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^(`{3,})\s*(\w*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith(fence[1])) body.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && isTableRule(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) body.push(cells(lines[i++]));
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
      );
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${markdownToHtml(quote.join('\n'))}</blockquote>`);
      continue;
    }
    if (listItem(line)) {
      const items: { depth: number; ordered: boolean; text: string }[] = [];
      let m: RegExpExecArray | null;
      while (i < lines.length && (m = listItem(lines[i]))) {
        items.push({ depth: Math.floor(m[1].length / 2), ordered: /\d/.test(m[2]), text: m[3] });
        i++;
      }
      out.push(renderList(items));
      continue;
    }
    // A paragraph: lines up to a blank line or the start of another block.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|>|`{3})/.test(lines[i]) && !listItem(lines[i]) && !isTableRow(lines[i])) para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]); // a line that looks like a block start but is not one: keep it as text
    out.push(`<p>${para.map(inline).join('<br>')}</p>`);
  }
  return out.join('\n');
}

function renderList(items: { depth: number; ordered: boolean; text: string }[]): string {
  let html = '';
  const stack: { depth: number; tag: 'ul' | 'ol' }[] = [];
  const close = (to: number) => {
    while (stack.length && stack[stack.length - 1].depth >= to) html += `</li></${stack.pop()!.tag}>`;
  };
  for (const it of items) {
    const tag = it.ordered ? 'ol' : 'ul';
    const top = stack[stack.length - 1];
    if (top && it.depth === top.depth) html += '</li>';
    else if (top && it.depth < top.depth) {
      close(it.depth + 1);
      html += '</li>';
    }
    if (!stack.length || it.depth > stack[stack.length - 1].depth) {
      html += `<${tag}>`;
      stack.push({ depth: it.depth, tag });
    }
    const task = /^\[( |x)\]\s+(.*)$/i.exec(it.text);
    html += task ? `<li class="task"><input type="checkbox" disabled${task[1].toLowerCase() === 'x' ? ' checked' : ''}> ${inline(task[2])}` : `<li>${inline(it.text)}`;
  }
  close(0);
  return html;
}
