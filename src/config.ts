/** Size of one isometric tile diamond, in source pixels (2:1 ratio). */
export const TILE_W = 32;
export const TILE_H = 16;

/** Map size in tiles. */
export const MAP_W = 128;
export const MAP_H = 128;

/** Rival villages: names and colours, same order as TOWN_SITES. */
export const RIVAL_TOWNS = [
  { name: 'Pedra Alta', color: 0xd05050 },
  { name: 'Vale Azul', color: 0x5078d8 },
  { name: 'Pinhal Dourado', color: 0xd8b040 },
];

/** Rival village centres, as fractions of the map size (the player's village is the centre). */
export const TOWN_SITES = [
  { x: 0.2, y: 0.22 },
  { x: 0.82, y: 0.25 },
  { x: 0.48, y: 0.84 },
];

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
export const BEDS_PER_HOUSE = 4;
/** Units a worker carries before walking to the stockpile. */
export const WORKER_LOAD = 5;
/** Workers take this many times the player's base time per unit (before their productivity). */
export const WORKER_TIME_FACTOR = 1.5;
export const MAX_WANDERERS = 3;
export const WANDERER_FIRST_SPAWN = 15;
export const WANDERER_INTERVAL = 150;
/** How long a wanderer stays on the map before leaving, if not recruited. */
export const WANDERER_STAY = 720;

/** Combat and animals. Damage/HP are in hit points. */
export const PLAYER_MAX_HP = 10;
/** Game seconds between +1 HP once the player hasn't been hit for PLAYER_REGEN_DELAY. */
export const PLAYER_REGEN_EVERY = 15;
export const PLAYER_REGEN_DELAY = 8;
export const ATTACK_COOLDOWN = 0.45;
export const ATTACK_REACH = 1.3;
export const VILLAGER_HP = 6;
/** HP restored by eating one meat (F). */
export const MEAT_HEAL = 2;
export const ANIMAL_SPAWN_INTERVAL = 15;
/** Multiplies every species' population (the map is 4× the original area). */
export const WILDLIFE_SCALE = 2.5;
/** Animals spawn at least this far from the village centre and the player. */
export const ANIMAL_SPAWN_DISTANCE = 14;
/** Carcasses rot away after this many game seconds. */
export const CARCASS_LIFETIME = 480;
/** Hunters shoot from this far (tiles). */
export const HUNTER_RANGE = 3.5;

/** Real seconds between autosaves (also saves at each new day and when the page closes). */
export const AUTOSAVE_SECONDS = 120;

/** Length of one in-game day, in real seconds at normal speed. */
export const DAY_SECONDS = 480;
export const START_HOUR = 7;
/** Holding T fast-forwards world time by this factor (testing aid for the clock and regrowth). */
export const FAST_FORWARD = 20;
