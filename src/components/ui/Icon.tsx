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
  settings: (
    <>
      <path d="M8.4 3h3.2l.5 2 1.4.8 2-.6 1.6 2.8-1.5 1.4v1.6l1.5 1.4-1.6 2.8-2-.6-1.4.8-.5 2H8.4l-.5-2-1.4-.8-2 .6-1.6-2.8L4.4 11V9.4L2.9 8l1.6-2.8 2 .6 1.4-.8z" />
      <circle cx="10" cy="10.2" r="2.3" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4.5" width="14" height="12.5" rx="1.8" />
      <path d="M3 8.5h14M7 3v3M13 3v3" />
    </>
  ),
  today: (
    <>
      <rect x="3" y="4.5" width="14" height="12.5" rx="1.8" />
      <path d="M3 8.5h14M7 3v3M13 3v3" />
      <circle cx="10" cy="12.7" r="1.2" fill="currentColor" />
    </>
  ),
  history: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l2.8 1.8" />
    </>
  ),
  export: <path d="M10 13V3.5M6.5 7L10 3.5 13.5 7M4 11.5V16h12v-4.5" />,
  download: <path d="M10 3.5V13M6.5 9.5L10 13l3.5-3.5M4 16.5h12" />,
  template: (
    <>
      <rect x="3" y="3" width="14" height="14" rx="1.8" />
      <path d="M3 7.5h14M8 7.5V17" />
    </>
  ),
  pages: <path d="M5 3h7l3.5 3.5V17H5zM12 3v3.5h3.5M7.5 10h5M7.5 13h5" />,
  folder: <path d="M3 6a1 1 0 0 1 1-1h4l2 2h6a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />,
  tag: (
    <>
      <path d="M3 10.5V4h6.5l7.5 7.5-6 6z" />
      <circle cx="6.8" cy="7.3" r="1" />
    </>
  ),
  outline: <path d="M4 5h12M7 10h9M10 15h6" />,
  graph: (
    <>
      <circle cx="10" cy="5" r="2" />
      <circle cx="5" cy="14.5" r="2" />
      <circle cx="15" cy="14.5" r="2" />
      <path d="M9 6.8L6 12.8M11 6.8l3 6M7 14.5h6" />
    </>
  ),
  command: <path d="M7 7h6v6H7zM7 7V5.5A1.5 1.5 0 1 0 5.5 7H7M13 7h1.5A1.5 1.5 0 1 0 13 5.5V7M7 13H5.5A1.5 1.5 0 1 0 7 14.5V13M13 13v1.5a1.5 1.5 0 1 0 1.5-1.5H13" />,
  user: (
    <>
      <circle cx="10" cy="7" r="3.2" />
      <path d="M3.8 17a6.2 6.2 0 0 1 12.4 0" />
    </>
  ),
  palette: (
    <>
      <path d="M10 3a7 7 0 1 0 0 14c1.3 0 1.7-.9 1.2-1.7-.5-1 .1-2.1 1.3-2.1H14a3 3 0 0 0 3-3C17 6.1 13.9 3 10 3z" />
      <circle cx="6.8" cy="9" r=".9" fill="currentColor" />
      <circle cx="9.5" cy="6.4" r=".9" fill="currentColor" />
      <circle cx="13" cy="7.2" r=".9" fill="currentColor" />
    </>
  ),
  sun: (
    <>
      <circle cx="10" cy="10" r="3.2" />
      <path d="M10 2.8v1.6M10 15.6v1.6M2.8 10h1.6M15.6 10h1.6M4.9 4.9l1.1 1.1M14 14l1.1 1.1M4.9 15.1L6 14M14 6l1.1-1.1" />
    </>
  ),
  moon: <path d="M16.5 11.8A6.6 6.6 0 0 1 8.2 3.5a6.6 6.6 0 1 0 8.3 8.3z" />,
  monitor: (
    <>
      <rect x="2.5" y="3.5" width="15" height="10" rx="1.6" />
      <path d="M7 17h6M10 13.5V17" />
    </>
  ),
  database: (
    <>
      <ellipse cx="10" cy="5" rx="6" ry="2.4" />
      <path d="M4 5v10c0 1.3 2.7 2.4 6 2.4s6-1.1 6-2.4V5M4 10c0 1.3 2.7 2.4 6 2.4s6-1.1 6-2.4" />
    </>
  ),
  info: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 9.2v4.6M10 6.4v.2" />
    </>
  ),
  edit: <path d="M4 16l1-4L14 3l3 3-9 9zM12 5l3 3" />,
  close: <path d="M5 5l10 10M15 5L5 15" />,
  check: <path d="M4 10.5l4 4 8-9" />,
  keyboard: (
    <>
      <rect x="2.5" y="5" width="15" height="10" rx="1.6" />
      <path d="M5.5 8.5h.01M8.5 8.5h.01M11.5 8.5h.01M14.5 8.5h.01M6 12h8" />
    </>
  ),
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
