/** A published copy of a workspace: one HTML page per page, an index, one stylesheet. Pure; the export feeds it the Markdown it already writes. */
import { esc, markdownToHtml } from './mdToHtml';

export interface SiteEntry {
  /** The file name without .html (already safe and unique). */
  slug: string;
  title: string;
  markdown: string;
}

const CSS = `:root{color-scheme:light dark;--ink:#1c2430;--bg:#fff;--rule:#d8dee6;--accent:#2845c9}
@media (prefers-color-scheme:dark){:root{--ink:#e6ebf2;--bg:#12161c;--rule:#2b3440;--accent:#8fa6ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:46rem;margin:0 auto;padding:2rem 1.25rem 4rem}nav{font-size:.9rem;margin-bottom:1.5rem}a{color:var(--accent)}
h1{font-size:2rem;line-height:1.2}h2,h3{margin-top:2rem}img{max-width:100%;height:auto;border-radius:6px}
blockquote{margin:1rem 0;padding:.25rem 1rem;border-left:4px solid #e6c84a;background:rgba(230,200,74,.12)}
pre{overflow:auto;padding:1rem;border:1px solid var(--rule);border-radius:6px}code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.92em}
table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid var(--rule);padding:.4rem .6rem;text-align:left}
li.task{list-style:none;margin-left:-1.2rem}ul,ol{padding-left:1.4rem}`;

const page = (title: string, body: string, back: boolean) =>
  `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><link rel="stylesheet" href="style.css"></head><body><main>${back ? '<nav><a href="index.html">← All pages</a></nav>' : ''}${body}</main></body></html>\n`;

/** The files of the site, by path. `siteTitle` heads the index. */
export function buildSite(entries: readonly SiteEntry[], siteTitle: string): Record<string, string> {
  const files: Record<string, string> = { 'style.css': CSS };
  for (const e of entries) files[`${e.slug}.html`] = page(e.title, markdownToHtml(e.markdown), true);
  files['index.html'] = page(siteTitle, `<h1>${esc(siteTitle)}</h1>\n<ul>${entries.map((e) => `<li><a href="${esc(encodeURI(e.slug))}.html">${esc(e.title)}</a></li>`).join('')}</ul>`, false);
  return files;
}
