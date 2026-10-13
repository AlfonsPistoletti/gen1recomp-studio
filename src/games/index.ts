import { gen1 } from "./gen1/index.ts";
import { gen2 } from "./gen2/index.ts";
import { FEATURES } from "../features.ts";
import type { GameAdapter, GameId } from "./types.ts";

export const GAME_OF_VERSION: Record<string, GameId> = {
  red: "gen1", blue: "gen1", yellow: "gen1",
  gold: "gen2", silver: "gen2", crystal: "gen2",
  firered: "gen3", leafgreen: "gen3", emerald: "gen3", ruby: "gen3", sapphire: "gen3",
};

export const GAME_NAMES: Record<GameId, string> = { gen1: "Gen 1", gen2: "Gen 2", gen3: "Gen 3" };

// unfinished generations only in development builds (src/features.ts)
const ADAPTERS: Partial<Record<GameId, GameAdapter>> = { gen1, ...(FEATURES.gen2 ? { gen2 } : {}) };

// The adapter for a version, or null while that generation is not supported.
export function adapterFor(version: string): GameAdapter | null {
  const game = GAME_OF_VERSION[version];
  return (game && ADAPTERS[game]) || null;
}
