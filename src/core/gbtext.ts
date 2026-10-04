// Game Boy text strings as the importer writes them (src/render/TextBox.lua):
// "\n" = second line, "\v" = scroll one line, "\f" = page break (wait for A),
// {PLAYER}/{RIVAL}/... are substituted when shown.
//
// The editor shows plain lines with a blank line between pages. Dialogue
// puts "\n" after a page's first line and "\v" after every later one;
// Pokédex entries use "\n" throughout. That covers all but a handful of
// vanilla strings, and a string is only rewritten when its text changes.

export type LineMode = "dialog" | "plain";

export const BOX_WIDTH = 18;

// How a string separates its lines (for writing edited text back).
export function lineMode(text: string): LineMode {
  if (text.includes("\v")) return "dialog";
  if (text.split("\f").some((page) => page.split("\n").length >= 3)) return "plain";
  return "dialog";
}

export function toEditable(text: string): string {
  return text
    .split("\f")
    .map((page) => page.replace(/\v/g, "\n"))
    .join("\n\n");
}

export function fromEditable(edited: string, mode: LineMode): string {
  return edited
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((page) => {
      const lines = page.split("\n");
      if (mode === "plain") return lines.join("\n");
      return lines.map((l, i) => (i === 0 ? l : (i === 1 ? "\n" : "\v") + l)).join("");
    })
    .join("\f");
}

// The commands the importer writes into strings, as the engine reads them
// (src/render/TextBox.lua TOKENS / ending). `button` ones get a quick-insert
// button in the Text workspace; `end` ones replace the string's ending.
export interface TextCommand {
  token: string;
  label: string;
  about: string;
  button?: boolean;
  end?: boolean;
}

export const TEXT_COMMANDS: TextCommand[] = [
  { token: "{PLAYER}", label: "Player", button: true, about: "The player's name (up to 7 letters; RED if unnamed)." },
  { token: "{RIVAL}", label: "Rival", button: true, about: "The rival's name (up to 7 letters; BLUE if unnamed)." },
  { token: "{DONE}", label: "Done", button: true, end: true, about: "Ends the text. The box closes on the next A/B press, with no arrow. Most NPC lines end with this." },
  { token: "{PROMPT}", label: "Prompt ▼", button: true, end: true, about: "Ends the text with the blinking ▼ and waits for A/B. Used when something follows: a choice, another text, a battle." },
  { token: "{USER}", label: "User", button: true, about: "Battle text: the Pokémon using the move." },
  { token: "{TARGET}", label: "Target", button: true, about: "Battle text: the Pokémon the move is used on." },
  { token: "{RAM:…}", label: "RAM", about: "A value the game fills in, e.g. {RAM:wStringBuffer} for an item name. Only works where the game sets that value." },
  { token: "{NUM:…}", label: "Number", about: "A number the game fills in (money, amounts). Only works where the game sets it." },
  { token: "{SCROLL}", label: "Scroll", about: "Scrolls the box one line without waiting. Rare, used in battle messages." },
  { token: "{_CONT}", label: "Cont", about: "Waits for A/B, then scrolls. Rare, system text only." },
  { token: "{COLON}", label: "Colon", about: "Prints a colon. Rare." },
];

// What placeholders stand for in the preview.
const SAMPLE: Record<string, string> = {
  PLAYER: "RED",
  RIVAL: "BLUE",
  TARGET: "PIDGEY",
  USER: "PIKACHU",
  COLON: ":",
  NUM: "123",
  RAM: "ITEM",
};

// The longest each can get, for the width check (names are 7 letters,
// Pokémon names 10).
const WIDEST: Record<string, number> = { PLAYER: 7, RIVAL: 7, TARGET: 10, USER: 10, NUM: 6, RAM: 12 };

// Control placeholders that end or pause the text rather than print.
const CONTROL = new Set(["DONE", "PROMPT", "SCROLL", "_CONT"]);

const PLACEHOLDER = /\{([A-Z_0-9]+)(?::[^}]*)?\}/g;

export function previewLine(line: string): string {
  return line.replace(PLACEHOLDER, (_m, name: string) => (CONTROL.has(name) ? "" : SAMPLE[name] ?? `{${name}}`));
}

// how wide a line can get once the game fills it in
export function lineWidth(line: string): number {
  return line.replace(PLACEHOLDER, (_m, name: string) => (CONTROL.has(name) ? "" : "x".repeat(WIDEST[name] ?? (SAMPLE[name] ?? name).length))).length;
}

// Pages of preview lines, lines that can get too wide for the dialogue box,
// and how the text ends ({PROMPT} draws the ▼).
export function preview(edited: string): {
  pages: string[][];
  tooWide: { page: number; line: number; length: number }[];
  ending: "done" | "prompt" | null;
} {
  const raw = edited.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((p) => p.split("\n"));
  const pages = raw.map((lines) => lines.map(previewLine));
  const tooWide: { page: number; line: number; length: number }[] = [];
  raw.forEach((lines, page) =>
    lines.forEach((l, line) => {
      const length = lineWidth(l);
      if (length > BOX_WIDTH) tooWide.push({ page, line, length });
    }),
  );
  const trimmed = edited.trimEnd();
  const ending = trimmed.endsWith("{PROMPT}") ? "prompt" : trimmed.endsWith("{DONE}") ? "done" : null;
  return { pages, tooWide, ending };
}

// The text with its ending command replaced by `token` (or added).
export function withEnding(edited: string, token: string): string {
  return edited.replace(/\s*\{(DONE|PROMPT)\}\s*$/, "").replace(/\s+$/, "") + token;
}
