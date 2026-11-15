import { version as packageVersion } from '../../package.json';

/** What this build is: from package.json, and (when built by Vite) the commit and time it was built. */
export interface BuildInfo {
  version: string;
  /** Short git commit, or '' when it was built outside a git checkout. */
  commit: string;
  /** ISO time of the build, or '' when unknown (unit tests). */
  builtAt: string;
  mode: 'development' | 'production';
}

export function buildInfo(): BuildInfo {
  if (typeof __BUILD_INFO__ !== 'undefined') return __BUILD_INFO__;
  return { version: packageVersion, commit: '', builtAt: '', mode: 'development' };
}

export const APP_NAME = 'Canvas Notes';

/** "9 November 2026", or "Unknown" when the date is missing or not a date. */
export function formatBuildDate(iso: string, locale?: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return 'Unknown';
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
}

export interface Environment {
  os: string;
  engine: string;
}

/** A readable operating system and web engine from the user-agent text (the desktop app runs in WebKitGTK, WebView2 or WKWebView). */
export function describeEnvironment(ua: string): Environment {
  const os = /Android/i.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/i.test(ua)
      ? 'iOS'
      : /Windows/i.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/i.test(ua)
          ? 'macOS'
          : /Linux|X11/i.test(ua)
            ? 'Linux'
            : 'Unknown';
  const engine = /Edg\/([\d.]+)/.exec(ua)
    ? `Edge / WebView2 ${/Edg\/(\d+)/.exec(ua)![1]}`
    : /Chrome\/(\d+)/.exec(ua)
      ? `Chromium ${/Chrome\/(\d+)/.exec(ua)![1]}`
      : /Version\/([\d.]+).*Safari/.exec(ua)
        ? `WebKit / Safari ${/Version\/([\d.]+)/.exec(ua)![1]}`
        : /AppleWebKit\/([\d.]+)/.exec(ua)
          ? `WebKit ${/AppleWebKit\/([\d.]+)/.exec(ua)![1]}`
          : /Firefox\/(\d+)/.exec(ua)
            ? `Firefox ${/Firefox\/(\d+)/.exec(ua)![1]}`
            : 'Unknown';
  return { os, engine };
}

export interface LibraryCounts {
  pages: number;
  groups: number;
  boxes: number;
  trash: number;
}

export interface DiagnosticsInput {
  build: BuildInfo;
  env: Environment;
  storage: 'desktop' | 'browser';
  counts: LibraryCounts;
  language: string;
  addons: string[];
}

/**
 * The text of "Copy diagnostics": version, build, system and how big the library is, for a bug report. It never contains note
 * titles, text, tags, group names, file paths or the pairing code, only numbers and names of settings.
 */
export function diagnosticsText(d: DiagnosticsInput): string {
  return [
    `${APP_NAME} ${d.build.version}${d.build.commit ? ` (${d.build.commit})` : ''}`,
    `Build: ${d.build.mode}, ${d.build.builtAt ? d.build.builtAt : 'time unknown'}`,
    `System: ${d.env.os}, ${d.env.engine}`,
    `Storage: ${d.storage === 'desktop' ? 'SQLite on this computer' : 'this browser (development mode)'}`,
    `Library: ${d.counts.pages} pages, ${d.counts.groups} groups, ${d.counts.boxes} boxes, ${d.counts.trash} in Trash`,
    `Language: ${d.language || 'unknown'}`,
    `Add-ons on: ${d.addons.length ? d.addons.join(', ') : 'none'}`,
  ].join('\n');
}
