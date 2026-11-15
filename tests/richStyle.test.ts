import { describe, expect, it } from 'vitest';
import { safeStyle, sizePx } from '../src/lib/richStyle';

describe('which inline styles rich text keeps', () => {
  it('keeps font size, colours and alignment', () => {
    expect(safeStyle('font-size: 24px; color: #ff0000; background-color: rgb(255, 255, 0); text-align: center')).toBe('font-size: 24px; color: #ff0000; background-color: rgb(255, 255, 0); text-align: center');
    expect(safeStyle('COLOR: Red')).toBe('color: Red');
    expect(safeStyle('text-align:JUSTIFY')).toBe('text-align: justify');
    expect(safeStyle('font-size: 18pt')).toBe('font-size: 18pt');
  });
  it('drops every other property', () => {
    expect(safeStyle('position: fixed; top: 0; z-index: 9999; font-size: 20px')).toBe('font-size: 20px');
    expect(safeStyle('background-image: url(http://evil/x.png)')).toBe('');
    expect(safeStyle('display: none')).toBe('');
  });
  it('drops values that could carry anything', () => {
    expect(safeStyle('color: url(http://evil)')).toBe('');
    expect(safeStyle('color: expression(alert(1))')).toBe('');
    expect(safeStyle('background-color: var(--x)')).toBe('');
    expect(safeStyle('color: inherit')).toBe('');
    expect(safeStyle('color: red; background: javascript:alert(1)')).toBe('color: red');
    expect(safeStyle('color: \\72 ed')).toBe('');
    expect(safeStyle('font-size: 99999px')).toBe('');
    expect(safeStyle('font-size: 2px')).toBe('');
    expect(safeStyle('font-size: big')).toBe('');
    expect(safeStyle('text-align: start')).toBe('');
    expect(safeStyle('')).toBe('');
    expect(safeStyle('nonsense')).toBe('');
  });
  it('turns a size into pixels', () => {
    expect(sizePx('24px')).toBe(24);
    expect(sizePx('18pt')).toBe(24);
    expect(sizePx('2em')).toBe(32);
    expect(sizePx('150%')).toBe(24);
    expect(sizePx('x')).toBeNull();
  });
});
