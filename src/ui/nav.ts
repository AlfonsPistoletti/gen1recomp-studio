// Cross-links between workspaces ("open in Pokémon", "edit this text", ...)
// without the workspaces importing each other. main.ts and the workspaces
// fill in the handlers when they mount.

export type WorkspaceId = "maps" | "pokemon" | "moves" | "trainers" | "text" | "global";

export const WORKSPACES: { id: WorkspaceId; label: string; key: string }[] = [
  { id: "maps", label: "Maps", key: "1" },
  { id: "pokemon", label: "Pokémon", key: "2" },
  { id: "moves", label: "Moves", key: "3" },
  { id: "trainers", label: "Trainers", key: "4" },
  { id: "text", label: "Text", key: "5" },
  { id: "global", label: "Global", key: "6" },
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
  openText: (_key: string): void => {},
};
