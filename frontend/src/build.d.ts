// Replaced at build time by `define` in vite.config.ts, which is also where
// the three values are worked out.
declare const __BUILD_TIME__: string
declare const __BUILD_SHA__: string

// 'production', 'staging', or 'development'. Compared against a literal so
// that the bar it guards is minified away entirely in a production build.
declare const __ENVIRONMENT__: string
