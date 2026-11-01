import { initials, type ProfileColor } from '../../lib/settings';

/** A round badge with the profile's initials, in one of the theme-aware palette colours. */
export function Avatar({ name, color, size = 32 }: { name: string; color: ProfileColor; size?: number }) {
  return (
    <span className="avatar" aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.42, background: `var(--c-${color})` }}>
      {initials(name) || '?'}
    </span>
  );
}
