// Features that aren't finished, by name. They are on while developing
// (npm run dev, npm run tauri dev) and off in release builds (vite build:
// npm run tauri build, the release workflow), where the flags are constants
// and the bundler drops the code behind them. VITE_EXPERIMENTAL=1 at build
// time turns them on in a build too (a test release).
// __EXPERIMENTAL__ comes from vite.config.ts (define); scripts run by Node,
// like the selftest, don't have it: off
declare const __EXPERIMENTAL__: boolean | undefined;
const experimental = typeof __EXPERIMENTAL__ !== "undefined" && __EXPERIMENTAL__;

export const FEATURES = {
  // Gold / Silver / Crystal (src/games/gen2): the view-only map viewer
  gen2: experimental,
};
