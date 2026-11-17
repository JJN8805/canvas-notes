/** A page's icon: one emoji or short mark shown beside its name. Anything else is dropped (it comes from storage, sync, backups and imports). */
export const MAX_ICON = 16;

export function cleanIcon(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || t.length > MAX_ICON) return null;
  // No markup, quotes, control characters or line breaks: the icon is drawn as text, but it also travels in JSON and SQL parameters.
  if (/[<>&"'`\\\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(t)) return null;
  return t;
}
