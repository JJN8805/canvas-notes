import { describe, expect, it } from 'vitest';
import { markdownToHtml, safeUrl, inline } from '../src/lib/mdToHtml';
import { buildSite } from '../src/lib/staticSite';

describe('Markdown to HTML for a published site', () => {
  it('makes headings, paragraphs, emphasis, code, links and pictures', () => {
    const h = markdownToHtml('# Title\n\nSome **bold** and *slanted* and `code`.\n\n[a link](https://example.com) ![pic](images/p.png)');
    expect(h).toContain('<h1>Title</h1>');
    expect(h).toContain('<strong>bold</strong>');
    expect(h).toContain('<em>slanted</em>');
    expect(h).toContain('<code>code</code>');
    expect(h).toContain('<a href="https://example.com">a link</a>');
    expect(h).toContain('<img src="images/p.png" alt="pic" loading="lazy">');
  });
  it('makes lists (with ticks and nesting), quotes, tables and fenced code', () => {
    expect(markdownToHtml('- [x] done\n- [ ] todo')).toBe('<ul><li class="task"><input type="checkbox" disabled checked> done</li><li class="task"><input type="checkbox" disabled> todo</li></ul>');
    expect(markdownToHtml('1. one\n2. two')).toBe('<ol><li>one</li><li>two</li></ol>');
    expect(markdownToHtml('- a\n  - b\n- c')).toBe('<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>');
    expect(markdownToHtml('<!-- sticky color: yellow -->\n> 📝 note\n> more')).toContain('<blockquote><p>📝 note<br>more</p></blockquote>');
    expect(markdownToHtml('| a | b |\n| --- | --- |\n| 1 | 2 |')).toContain('<th>a</th>');
    expect(markdownToHtml('```\n<b>x</b> & y\n```')).toBe('<pre><code>&lt;b&gt;x&lt;/b&gt; &amp; y</code></pre>');
  });
  it('never lets markup or a dangerous address through', () => {
    const hostile = '# <script>alert(1)</script>\n\n<img src=x onerror=alert(1)> [x](javascript:alert(1)) ![y](data:text/html;base64,AAAA) [z](//evil.example/a) **<i onmouseover=1>**\n\n> <iframe src=//evil></iframe>\n\n| <b>a</b> | b |\n| --- | --- |\n| <u>1</u> | 2 |';
    const h = markdownToHtml(hostile);
    expect(h).not.toMatch(/<(script|iframe|u|b|i)[\s>]/i); // text that looks like a tag is shown as text, never made into one
    expect(h).not.toMatch(/<[^>]*\son(error|mouseover)=/i); // and no real tag carries an event handler
    expect(h).not.toMatch(/href="javascript:|src="data:|href="\/\/|src="\/\//i);
    expect(h).toContain('&lt;script&gt;');
    expect(safeUrl('JavaScript:alert(1)')).toBe('#');
    expect(safeUrl(' vbscript:x')).toBe('#');
    expect(safeUrl('images/a b.png')).toBe('images/a b.png');
    expect(safeUrl('mailto:me@example.com')).toBe('mailto:me@example.com');
    expect(inline('"quoted" & <tag>')).toBe('&quot;quoted&quot; &amp; &lt;tag&gt;');
  });
  it('keeps a quote character from breaking out of an attribute', () => {
    const h = markdownToHtml('[x](a"onmouseover="1) ![al"t](p.png)');
    expect(h).not.toMatch(/ onmouseover=/);
    expect(h).not.toContain('al"t');
  });
});

describe('the site', () => {
  const files = buildSite([{ slug: 'Plan & more', title: 'Plan <1>', markdown: '# Plan <1>\n\nHi' }, { slug: 'Other', title: 'Other', markdown: '# Other' }], 'My <desk>');
  it('has an index linking every page, one file per page and a stylesheet', () => {
    expect(Object.keys(files).sort()).toEqual(['Other.html', 'Plan & more.html', 'index.html', 'style.css']);
    expect(files['index.html']).toContain('<a href="Plan%20&amp;%20more.html">Plan &lt;1&gt;</a>');
    expect(files['index.html']).toContain('<title>My &lt;desk&gt;</title>');
    expect(files['Other.html']).toContain('href="index.html"');
    expect(files['Other.html']).toContain('<meta name="viewport"');
  });
  it('escapes titles and brings no script of its own', () => {
    for (const html of Object.values(files)) expect(html).not.toMatch(/<script/i);
    expect(files['Plan & more.html']).toContain('<title>Plan &lt;1&gt;</title>');
  });
});

import { pageToMarkdown } from '../src/export/export';
import type { Page } from '../src/types';

describe('a real page through the page export and into a website', () => {
  const page: Page = {
    id: 'p', title: 'Trip <plan>', groupId: null, tags: ['travel'], arrows: [], created: 1, updated: 1, rev: 0,
    blocks: [
      { id: 'a', type: 'note', style: 'text', x: 0, y: 0, w: 300, h: 80, z: 1, html: '<h2>Packing</h2><p>Bring <strong>warm</strong> clothes</p><ul><li>boots</li></ul>' },
      { id: 'b', type: 'checklist', x: 0, y: 100, w: 300, h: 80, z: 2, items: [{ id: 'i1', text: 'Book train', done: true }, { id: 'i2', text: 'Passport', done: false }] },
      { id: 'c', type: 'note', style: 'sticky', x: 0, y: 200, w: 200, h: 200, z: 3, html: '<p>Ask Sam</p>', tint: 'yellow' },
      { id: 'd', type: 'table', x: 0, y: 420, w: 300, h: 80, z: 4, rows: [['Day', 'Plan'], ['1', 'Arrive']] },
      { id: 'e', type: 'image', x: 0, y: 520, w: 200, h: 120, z: 5, imageId: 'img1', aspect: 1.5, alt: 'Map' },
      { id: 'f', type: 'note', style: 'code', x: 0, y: 660, w: 300, h: 80, z: 6, html: '', code: '<b>x</b>' },
    ],
  };
  const html = buildSite([{ slug: 'Trip', title: page.title, markdown: pageToMarkdown(page, (b) => `images/${b.imageId}.png`) }], 'Desk')['Trip.html'];
  it('keeps the words, lists, ticks, quote, table, picture and code, and escapes the title', () => {
    expect(html).toContain('<h1>Trip &lt;plan&gt;</h1>');
    expect(html).toContain('<strong>warm</strong>');
    expect(html).toContain('<li>boots</li>');
    expect(html).toContain('checked> Book train');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('Ask Sam');
    expect(html).toContain('<td>Arrive</td>');
    expect(html).toContain('<img src="images/img1.png" alt="Map"');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toMatch(/<b>x<\/b>/);
  });
});
