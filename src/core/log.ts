// The session log behind "Report a bug…": the last lines of what happened
// (toasts, uncaught errors, console errors and warnings, projects opened),
// kept in memory only. Nothing is written to disk or sent anywhere.

const MAX_LINES = 400;
const lines: string[] = [];

export function log(kind: string, message: string): void {
  const time = new Date().toISOString().slice(11, 19);
  lines.push(`${time} ${kind.padEnd(5)} ${message.replace(/\s+$/, "")}`);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
}

const text = (v: unknown): string =>
  v instanceof Error ? `${v.message}${v.stack ? `\n${v.stack}` : ""}` : typeof v === "string" ? v : JSON.stringify(v) ?? String(v);

// The user's own folder name stays out of reports (C:\Users\<name>, /home/<name>, /Users/<name>).
const anonymous = (s: string): string =>
  s.replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/"'\n]+/gi, "$1<you>").replace(/(\/(?:home|Users)\/)[^/\s"']+/g, "$1<you>");

export function logText(): string {
  return anonymous(lines.join("\n"));
}

// uncaught errors, failed promises and console errors/warnings
export function installLog(): void {
  window.addEventListener("error", (e) => log("error", text(e.error ?? e.message)));
  window.addEventListener("unhandledrejection", (e) => log("error", `unhandled: ${text(e.reason)}`));
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      log(level, args.map(text).join(" "));
      original(...args);
    };
  }
}
