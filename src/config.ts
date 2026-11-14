/** Size of one isometric tile diamond, in source pixels (2:1 ratio). */
export const TILE_W = 32;
export const TILE_H = 16;

/** Map size in tiles. */
export const MAP_W = 64;
export const MAP_H = 64;

/** The v1 map is fixed: same seed every run. Change it only on purpose. */
export const MAP_SEED = 1337;

/** Integer camera zooms keep pixel art crisp. */
export const ZOOM_LEVELS = [2, 3, 4] as const;
export const DEFAULT_ZOOM_INDEX = 1;

/** Player movement, in tiles per second. */
export const PLAYER_SPEED = 3.5;
export const PLAYER_RUN_MULTIPLIER = 1.7;
/** Half-size of the player's collision box, in tiles. */
export const PLAYER_RADIUS = 0.22;

/** How far (tile units, player to the tile's nearest edge) the player can reach to gather or use things. */
export const INTERACT_REACH = 0.9;
/** Player inventory: 9 hotbar slots + bag slots (Minecraft-style). Stack sizes are in src/game/slots.ts. */
export const HOTBAR_SLOTS = 9;
export const INVENTORY_SLOTS = HOTBAR_SLOTS + 18;
/** How much the player can carry, in kg. Item weights are in src/game/slots.ts (ITEM_WEIGHT). */
export const MAX_CARRY_WEIGHT = 40;

/** NPCs. Times are game seconds (see DAY_SECONDS). */
export const NPC_SPEED = 1.6;
export const NPC_REACH = 1.1;
export const BEDS_PER_HOUSE = 2;
export const MAX_WANDERERS = 3;
export const WANDERER_FIRST_SPAWN = 15;
export const WANDERER_INTERVAL = 150;
/** How long a wanderer stays on the map before leaving, if not recruited. */
export const WANDERER_STAY = 720;

/** Length of one in-game day, in real seconds at normal speed. */
export const DAY_SECONDS = 480;
export const START_HOUR = 7;
/** Holding T fast-forwards world time by this factor (testing aid for the clock and regrowth). */
export const FAST_FORWARD = 20;
