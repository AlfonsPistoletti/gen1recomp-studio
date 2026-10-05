// The Game Corner prize counters, restated from gen1recomp
// data/scripts/story3.lua (pokered data/events/prizes.asm and
// prize_mon_levels.asm). The engine keeps them as local tables in a script a
// release build packs into the exe, so the studio carries its own copy. Each
// counter is a sign on GAME_CORNER_PRIZE_ROOM and shows one window of three.

import type { PrizeCounter } from "../types.ts";

const ROOM = "GAME_CORNER_PRIZE_ROOM";
const VENDOR = (n: number) => `${ROOM}:TEXT_GAMECORNERPRIZEROOM_PRIZE_VENDOR_${n}`;

const TMS: PrizeCounter = {
  prizes: [
    { item: "TM_DRAGON_RAGE", cost: 3300 },
    { item: "TM_HYPER_BEAM", cost: 5500 },
    { item: "TM_SUBSTITUTE", cost: 7700 },
  ],
};

const WINDOWS: Record<string, [PrizeCounter, PrizeCounter]> = {
  red: [
    { prizes: [{ species: "ABRA", level: 9, cost: 180 }, { species: "CLEFAIRY", level: 8, cost: 500 }, { species: "NIDORINA", level: 17, cost: 1200 }] },
    { prizes: [{ species: "DRATINI", level: 18, cost: 2800 }, { species: "SCYTHER", level: 25, cost: 5500 }, { species: "PORYGON", level: 26, cost: 9999 }] },
  ],
  blue: [
    { prizes: [{ species: "ABRA", level: 6, cost: 120 }, { species: "CLEFAIRY", level: 12, cost: 750 }, { species: "NIDORINO", level: 17, cost: 1200 }] },
    { prizes: [{ species: "PINSIR", level: 20, cost: 2500 }, { species: "DRATINI", level: 24, cost: 4600 }, { species: "PORYGON", level: 18, cost: 6500 }] },
  ],
  yellow: [
    { prizes: [{ species: "ABRA", level: 15, cost: 230 }, { species: "VULPIX", level: 18, cost: 1000 }, { species: "WIGGLYTUFF", level: 22, cost: 2680 }] },
    { prizes: [{ species: "SCYTHER", level: 30, cost: 6500 }, { species: "PINSIR", level: 30, cost: 6500 }, { species: "PORYGON", level: 26, cost: 9999 }] },
  ],
};

// counter id ("<MAP_ID>:<TEXT_ID>") -> its prizes, for one game version
export function vanillaPrizes(version: string | undefined): Record<string, PrizeCounter> {
  const [mon1, mon2] = WINDOWS[version ?? "red"] ?? WINDOWS.red;
  return { [VENDOR(1)]: structuredClone(mon1), [VENDOR(2)]: structuredClone(mon2), [VENDOR(3)]: structuredClone(TMS) };
}
