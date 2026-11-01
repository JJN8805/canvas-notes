const PATHS = {
  text: <path d="M4 5.5V4h12v1.5M10 4v12M7.5 16h5" />,
  image: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="1.5" />
      <circle cx="7.5" cy="8" r="1.3" />
      <path d="M3.5 14l4-4 3 3 2-2 4 4" />
    </>
  ),
  checklist: (
    <>
      <rect x="3" y="3.5" width="5" height="5" rx="1" />
      <path d="M11 6h6M11 14h6" />
      <rect x="3" y="11.5" width="5" height="5" rx="1" />
      <path d="M4.3 14l1 1 1.6-1.8" />
    </>
  ),
  code: <path d="M7 6l-4 4 4 4M13 6l4 4-4 4" />,
  table: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="1.5" />
      <path d="M3 8h14M3 12h14M8 4v12" />
    </>
  ),
  back: <path d="M12 5l-5 5 5 5" />,
  plus: <path d="M10 4v12M4 10h12" />,
  minus: <path d="M4 10h12" />,
  trash: <path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10" />,
  copy: (
    <>
      <rect x="7" y="7" width="9" height="9" rx="1.5" />
      <path d="M13 7V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" />
    </>
  ),
  layer: (
    <>
      <path d="M10 3l7 4-7 4-7-4 7-4z" />
      <path d="M3 11l7 4 7-4" />
    </>
  ),
  undo: <path d="M7 8H13a4 4 0 0 1 0 8h-3M7 8l3-3M7 8l3 3" />,
  redo: <path d="M13 8H7a4 4 0 0 0 0 8h3M13 8l-3-3M13 8l-3 3" />,
  link: <path d="M8.5 11.5l3-3M7 9.5L5.5 11a2.5 2.5 0 0 0 3.5 3.5L10.5 13M13 10.5l1.5-1.5A2.5 2.5 0 0 0 11 5.5L9.5 7" />,
  select: (
    <>
      <rect x="3" y="3" width="14" height="14" rx="2" strokeDasharray="2.5 2.5" />
      <path d="M7 10l2 2 4-4" />
    </>
  ),
  sync: <path d="M15.5 8A6 6 0 0 0 5 6M4.5 12A6 6 0 0 0 15 14M5 3v3h3M15 17v-3h-3" />,
  search: (
    <>
      <circle cx="9" cy="9" r="5" />
      <path d="M13 13l3.5 3.5" />
    </>
  ),
  sticky: <path d="M4 4h12v8l-4 4H4zM12 16v-4h4" />,
  frame: <rect x="3" y="3" width="14" height="14" rx="1.5" strokeDasharray="2.5 2" />,
  draw: <path d="M4 16l1-4L14 3l3 3-9 9-4 1zM12 5l3 3" />,
  chevron: <path d="M6 8l4 4 4-4" />,
} as const;

export type IconName = keyof typeof PATHS | 'more' | 'grip';

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  if (name === 'more') {
    return (
      <svg viewBox="0 0 20 20" width={size} height={size} fill="currentColor" aria-hidden="true">
        <circle cx="5" cy="10" r="1.5" />
        <circle cx="10" cy="10" r="1.5" />
        <circle cx="15" cy="10" r="1.5" />
      </svg>
    );
  }
  if (name === 'grip') {
    return (
      <svg viewBox="0 0 20 20" width={size} height={size} fill="currentColor" aria-hidden="true">
        {[5, 10, 15].map((y) => (
          <g key={y}>
            <circle cx="7" cy={y} r="1.4" />
            <circle cx="13" cy={y} r="1.4" />
          </g>
        ))}
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
