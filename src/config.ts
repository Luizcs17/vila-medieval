/** Size of one isometric tile diamond, in source pixels (2:1 ratio). */
export const TILE_W = 32;
export const TILE_H = 16;

/** Map size in tiles. */
export const MAP_W = 128;
export const MAP_H = 128;

/** Coins each village starts with (rivals get double). */
export const STARTING_COINS = 60;

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
/** Walking on a road is this much faster (player and villagers). */
export const ROAD_SPEED = 1.4;
/** Pathfinding cost of a road tile relative to open ground (lower = roads preferred). */
export const ROAD_COST = 0.6;

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
/** One in-game day is one year of life; villagers are adults (can work, marry) from this age. */
export const ADULT_AGE = 16;
/** Units a worker carries before walking to the stockpile. */
export const WORKER_LOAD = 5;
/** Workers take this many times the player's base time per unit (before their productivity). */
export const WORKER_TIME_FACTOR = 1.5;
export const MAX_WANDERERS = 3;
export const WANDERER_FIRST_SPAWN = 15;
export const WANDERER_INTERVAL = 150;
/** How long a wanderer stays on the map before leaving, if not recruited. */
export const WANDERER_STAY = 720;
/** Before you have a village, up to this many wanderers can travel with you as companions. */
export const COMPANION_MAX = 4;
/** Companions fight hostiles this close to them, as long as the fight stays this close to you. */
export const COMPANION_RANGE = 6;
export const COMPANION_LEASH = 10;
/** F1/F2 quick orders reach your companions and soldiers this close to you. */
export const QUICK_ORDER_RADIUS = 15;
/** Idle villagers help build: each adds this fraction of the player's building speed (game time). */
export const BUILDER_RATE = 0.4;
/** …at construction sites of their village up to this far away. */
export const BUILDER_RANGE = 40;
/** Chance a grass tuft gives a seed when gathered. */
export const SEED_CHANCE = 0.12;

/** Combat and animals. Damage/HP are in hit points. */
export const PLAYER_MAX_HP = 10;
/** Game seconds between +1 HP once the player hasn't been hit for PLAYER_REGEN_DELAY. */
export const PLAYER_REGEN_EVERY = 15;
export const PLAYER_REGEN_DELAY = 8;
export const ATTACK_COOLDOWN = 0.45;
export const ATTACK_REACH = 1.3;
export const VILLAGER_HP = 6;
/** Extra HP for soldiers (Quartel). */
export const SOLDIER_BONUS_HP = 6;
/** Soldiers react to hostiles this close, but won't chase further than GUARD_LEASH from their barracks. */
export const GUARD_RANGE = 8;
export const GUARD_LEASH = 14;
/** Hit points a player restores per second when repairing (costs 1 wood per 10 HP). */
export const REPAIR_RATE = 15;
/** Game seconds between raids a warring village sends. */
export const RAID_INTERVAL = 300;
/** HP restored by eating one meat (F). */
export const MEAT_HEAL = 2;
/** The player's hunger: satiety 0–100 drops this much per game day; one meat gives PLAYER_MEAL back. */
export const PLAYER_HUNGER_PER_DAY = 70;
export const PLAYER_MEAL = 35;
/** With satiety at zero the player loses 1 HP this often (game seconds) and doesn't regenerate. */
export const PLAYER_STARVE_EVERY = 12;
/** Claiming land: the hall must stand this close to your house. */
export const CLAIM_NEAR_HOME = 12;
export const ANIMAL_SPAWN_INTERVAL = 15;
/** Multiplies every species' population (the map is 4× the original area). */
export const WILDLIFE_SCALE = 2.5;
/** Animals spawn at least this far from the village centre and the player. */
export const ANIMAL_SPAWN_DISTANCE = 14;
/** Carcasses rot away after this many game seconds. */
export const CARCASS_LIFETIME = 480;
/** Hunters shoot from this far (tiles). */
/** Bow range: longer than the distance at which deer (4.5) and rabbits (3.5) bolt. */
export const HUNTER_RANGE = 6;
/** Damage of a hunter's arrow (deer have 3 HP, rabbits 1). */
export const HUNTER_DAMAGE = 2;

/** Real seconds between autosaves (also saves at each new day and when the page closes). */
export const AUTOSAVE_SECONDS = 120;

/** Length of one in-game day, in real seconds at normal speed. */
export const DAY_SECONDS = 480;
export const START_HOUR = 7;
/** Holding T fast-forwards world time by this factor (testing aid for the clock and regrowth). */
export const FAST_FORWARD = 20;
