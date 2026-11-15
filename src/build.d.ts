/** Filled in by vite.config.ts at build time (`define`); absent in unit tests, so read it through `buildInfo()` in lib/appInfo.ts. */
declare const __BUILD_INFO__: { version: string; commit: string; builtAt: string; mode: 'development' | 'production' };

/** The ready-made feature set this build starts with (`FEATURE_PROFILE=office npm run dev`); empty = everything. Saved choices in Settings win. */
declare const __FEATURE_PROFILE__: string;
