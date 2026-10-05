import type { Block } from "../core/eventBlocks.ts";

// Cross-links between workspaces ("open in Pokémon", "edit this text", ...)
// without the workspaces importing each other. main.ts and the workspaces
// fill in the handlers when they mount.

export type WorkspaceId = "maps" | "pokemon" | "moves" | "items" | "trainers" | "text" | "events" | "global";

export const WORKSPACES: { id: WorkspaceId; label: string; key: string }[] = [
  { id: "maps", label: "Maps", key: "1" },
  { id: "pokemon", label: "Pokémon", key: "2" },
  { id: "moves", label: "Moves", key: "3" },
  { id: "items", label: "Items", key: "4" },
  { id: "trainers", label: "Trainers", key: "5" },
  { id: "text", label: "Text", key: "6" },
  { id: "events", label: "Events", key: "7" },
  { id: "global", label: "Global", key: "8" },
];

export type PropsTab = "base" | "encounters";

export const nav = {
  workspace: "maps" as WorkspaceId,
  setWorkspace: (_id: WorkspaceId): void => {},
  // Maps workspace
  openMap: (_mapId: string): void => {},
  selectEntity: (_mapId: string, _layer: string, _index: number): void => {},
  showPropsTab: (_tab: PropsTab): void => {},
  // other workspaces
  openPokemon: (_id: string): void => {},
  // team: 1-based team number to scroll to and highlight
  openTrainer: (_id: string, _team?: number): void => {},
  openMove: (_id: string): void => {},
  openItem: (_id: string): void => {},
  openText: (_key: string): void => {},
  // an event: a studio_events id, or game:<MAP>:talk:<TEXT> for the game's own
  openEvent: (_id: string): void => {},
  openGlobal: (_section: string): void => {},
  // play an event's blocks on its map (start: where the player stands)
  playEvent: (_mapId: string, _blocks: Block[], _start: { x: number; y: number; facing: string } | null): void => {},
  // pick one cell on a map, then come back
  pickCell: (_mapId: string, _picked: (x: number, y: number) => void): void => {},
  // draw a walking path on a map: clicks extend it, Escape finishes
  drawPath: (_mapId: string, _start: { x: number; y: number }, _dirs: string[], _changed: (dirs: string[]) => void, _done: () => void): void => {},
};
