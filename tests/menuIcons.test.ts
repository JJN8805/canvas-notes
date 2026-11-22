import { describe, expect, it } from 'vitest';
import { iconForLabel } from '../src/lib/menuIcons';

describe('a picture for every menu entry', () => {
  const cases: [string, string][] = [
    ['Open', 'pages'], ['Select', 'select'], ['Add icon…', 'sparkle'], ['Change icon…', 'sparkle'], ['Archive', 'archive'], ['Rename…', 'rename'],
    ['Duplicate', 'copy'], ['Save as template…', 'template'], ['Cover image…', 'image'], ['Remove cover image', 'close'], ['Delete page', 'trash'],
    ['Delete this workspace…', 'trash'], ['Markdown (.md)', 'text'], ['PDF', 'pdf'], ['Excel workbook (.xlsx)', 'table'], ['Move to Student', 'move'],
    ['Copy to Main', 'copy'], ['New workspace…', 'workspace'], ['Quick note to Main…', 'plus'], ['Find in every workspace…', 'search'],
    ['Today in every workspace…', 'today'], ['Pin to desktop', 'pin'], ['Edit name and description…', 'rename'], ['New section…', 'folder'],
    ['Add a picture to the section…', 'image'], ['Move up (before the section above)', 'swap'], ['Bring to front', 'layer'], ['Links…', 'link'],
    ['Lock in place', 'lock'], ['Unlock', 'unlock'], ['Tidy layout…', 'outline'], ['Portrait page', 'pages'], ['Ungrouped', 'folder'], ['Sticky', 'sticky'],
  ];
  it.each(cases)('%s gets %s', (label, icon) => expect(iconForLabel(label)).toBe(icon));
  it('gives nothing to a word it does not know', () => {
    expect(iconForLabel('Banana')).toBeNull();
    expect(iconForLabel('')).toBeNull();
  });
});
