# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Isometric medieval village builder with a dark, medieval look. The player controls a protagonist with WASD, gathers wood, stone and iron by hand, hunts for meat and leather, crafts tools (or has a smithy forge them), and grows the population by recruiting wanderers and through families. Three rival villages work, grow, trade and wage war with the same AI; territory, diplomacy (diplomats), conquest, roads, coins and trade caravans tie them together. A new game starts with nothing: the player survives (hunger), builds their own house, then claims land to found the village; before that, wanderers can travel with them as companions. The player can found colonies (more villages of their own). Design decisions and the milestone list (v1: milestones 1–10, v2: 11–15, then 16–18; 19–29 came from `docs/BACKLOG.md`) live in `docs/GDD.md` (Portuguese); `CHANGELOG.md` has one entry per milestone. Farms grow food from seeds (found in grass). Not done yet: seasons, production chains, final art. The user communicates in Brazilian Portuguese, and in-game text is Portuguese.

## Commands

- `npm run dev`: **dev** server on http://localhost:5173 (also `.claude/launch.json` → "game"). Changes with every edit.
- `npm run prod`: **prod** server on http://localhost:4173 (`.claude/launch.json` → "prod"), where the user plays a stable build while development continues. It serves `<repo folder>-prod/dist`, a git worktree detached at `main`.
- `npm run prod:update`: moves the prod worktree to the latest `main`, runs `npm ci` and builds it. Run it only after a milestone is merged and checked, never mid-feature; then restart the prod server. Prod and dev keep separate save games (browser storage is per port).
- `npm run check`: typecheck + Biome lint + all tests. Run this before every commit; CI runs it too.
- `npm test` / `npx vitest run tests/npcs.test.ts -t "best-first"`: all tests, or one file / test
- `npm run format`: Biome auto-fix (formatting, import order, safe lint fixes)
- `npm run build`: typecheck + production build to `dist/` (relative `base` so it can be packaged as a desktop app later)

Fonts are bundled with `@fontsource` (MedievalSharp for titles, Alegreya for text) and awaited in `src/main.ts` before Phaser starts, because Phaser bakes text into canvases.

Tooling notes:

- TypeScript is v7 (the native compiler). `typescript-eslint` doesn't support it, which is why lint and format use **Biome** (`biome.json`: 2 spaces, single quotes, 130 columns).
- Biome flags `forEach` callbacks that return a value. Use `for…of` or a braced body instead.

## Workflow

- One branch per milestone or feature (`feat/m7-animals`, `chore/…`), then a `--no-ff` merge into `main`.
- With each change, bump `package.json` (each milestone is a minor version) and add a `CHANGELOG.md` entry.
- After merging a finished milestone into `main`, run `npm run prod:update` so the user's playable build moves forward.
- Pending requests live in `docs/BACKLOG.md`. Don't start backlog items until the user explicitly allows it.
- There is no git remote yet. `.github/workflows/ci.yml` runs `npm run check` and the build once one exists.

## Architecture

TypeScript + Phaser 3.90 + Vite. No asset files: all art is generated at boot.

### Space, time, rendering

- **Coordinates.** Game logic runs in continuous _grid space_ (tile units; tile `(i,j)` covers `[i,i+1)×[j,j+1)`). Rendering is in _screen space_. `src/iso.ts` converts between them. WASD input is a screen-space direction converted with `screenDirToGrid`, so "W" always moves up on the monitor. Never store screen positions as game state.
- **Depth sorting.** Ground tiles sit at a constant very low depth. Everything standing uses `depth = screen y of its feet`, with origin `(0.5, 1)`. A single depth can't sort a 2×2 building against the player, so `WorldScene.sortBuildingsAroundPlayer` decides exactly near the player. `fadeObjectsInFrontOfPlayer` makes tall things translucent when they cover the player.
- **Two time streams.** The player's movement, gathering and building use real `dt`. World simulation (clock, regrowth, NPC movement and work, animals, hunger, spawners) uses `worldDt`, which holding T multiplies by `FAST_FORWARD`. New simulation code should use `worldDt`.
- **Placeholder art.** `src/gfx/textures.ts` paints every texture into canvases (`fromRows` pixel strings, `isoBuilding` for size×size houses with timber framing and roof patterns, procedural trees, rocks and animals). Villagers are built per appearance by `src/gfx/people.ts` (`ensurePersonTextures(scene, look)`, cached by look key). Real art should replace a texture by loading an image under the same key. Texture creation is guarded so it can run again after a scene restart. The ground is baked into 16×16-tile render-texture chunks (`drawGround`); roads are flat images just above it.
- **Theme.** The palette is dark and earthy. `src/ui/theme.ts` holds fonts and colours (parchment text, oak panels, bronze trim). UIScene adds the vignette and the day/night tint (`ambientAt`).

### Rules (Phaser-free, unit-tested) in `src/game/`

- `map.ts` (in `src/world/`): a deterministic 128×128 map from a constant seed (a test enforces it), with dry clearings at `map.sites` (index 0 is the player's village, the rest are `TOWN_SITES`). Ground and objects are flat arrays indexed `y * w + x`. `isWalkable` is the single source of truth for collision. Building tiles are `Obj.Building`, except gates (`Obj.Gate`: walkable for people, blocked for animals and raiders). Roads are `Obj.Road` (walkable, faster, cheaper for A*).
- `inventory.ts`: resource types and `Inventory`, the stockpile's amount bag (`canAfford` / `pay`).
- `items.ts`: `ITEM_DEFS` for every slot item (resources, tools, weapons and armour: weight, stack size, tool type, speed, damage, durability, armour `reduction`), `maxDurability`, and `RECIPES` (cost and smithy `seconds`).
- `slots.ts`: `SlotInventory`, the player's Minecraft-style inventory. Capacity is limited by **weight** (`maxWeight`), slots and stack size. `space(item)` is the single "can I pick this up" check. Tools don't stack and carry `durability`; mouse operations, `stow` and `quickMove` preserve it. `takeAllResources` never takes tools.
- `gathering.ts`: `NODE_DEFS` (yield, time, tool type, `needsTool`, depleted form, regrow time), `ResourceNodes` (depletion and regrowth that mutate `map.objects`), `nearestTile` (reach measured to the tile's nearest edge) and `Gatherer`.
- `buildings.ts`: `BUILDING_DEFS` (footprint, cost, build time, `near`, `deposit`, `job`, `claim` radius, `maxHp`, tower `defense`, `repeatPlace`) and `Buildings` (placement `check`, `at(i)`, construction, damage/repair/remove). Every building has a `faction`. Each village's hall is a `stockpile`; the player has none until they claim land (`WorldScene.settled`). `home` is the player's own house (one, buildable before the village; its inventory is the faction-0 stock until then), and `deposit` buildings feed their village's stock. `road`, `colony` and `claim` are pseudo-types (`claim` raises the player's first hall near their house): placing a road writes `Obj.Road`, placing a colony founds a new village with its own hall (WorldScene.tryPlace). Every building has an inventory (`storage`); workplaces keep their tools there, and the smithy has a production `queue`. `demolitionRefund` gives half back (all for unfinished sites). Moving (`Buildings.move`, `relocationCost`: half, rounded up; `WorldScene.relocate`) turns a building back into a site at the new spot; workers of an unbuilt workplace help rebuild it.
- `factions.ts`: `Faction` (name, colour, stock, coins, tool warehouse, centre, alive, ruler, `parent`) and `TradePolicy`. Faction 0 is the player, whose stock is `WorldScene.stockpile`. **Colonies** are extra factions after the rivals with `isPlayer: true` and `parent: 0` (`createColony`, `colonySiteOk`); each has its own stock, territory and villagers. Use `WorldScene.isMine(f)` for "is this the player's", not `=== PLAYER_FACTION`, unless you mean the home village only (plunder, coins, recruiting).
- `storage.ts`: the `Storage` interface over a village's stock (`villageStorage`: resources in `stock`, tools in `tools`) or a building's inventory (`buildingStorage`), with `takeFrom` / `putInto` for the storage panel.
- `gear.ts`: workplace tools (`toolForWorker`: one accepted tool per worker, best first; `wearWorkplaceTool`; `autoSupply` moves tools from the village stock to workers lacking one, run by `WorldScene.autoSupplyTools`), the smithy (`tickSmithy`, `smithyCanWork`, `unqueue`), armour (`absorb`), `grantStarterTools`, and the soldier `WEAPONS`/`ARMORS` lists.
- `territory.ts`: tile ownership from building claims (nearest building wins). `canBuild` requires the footprint centre on your land and no foreign tiles.
- `towns.ts`: `foundTown`, `populateTown`, `findSpot` (keeps a 1-tile lane), `buildRoadNetwork`.
- `families.ts`: ages (1 day = 1 year, `born`), affinity and marriage, births (inherited surname, skills, traits, look), old age, and the player's marriage (person id 0 = the player). `Population.deceased` keeps the dead for the family tree.
- `diplomacy.ts`: pairwise relations (score and peace/alliance/war), `declareWar` (allies join), daily AI decisions, proposals to the player, and mission success chances. `realm` maps a colony to its founder, so colonies share the founder's relations and wars; pass only independent villages (`WorldScene.realms()`) to `daily` and `declareWar`.
- `trade.ts`: goods (resources and tools), supply-based `localPrice`, `sellPrice`/`buyPrice`, `executeTrade` against a `Market` interface, `quoteBuy`/`quoteSell` for trading in person (`WorldScene.peddle`, `PeddleUI`), and `planAiCaravan`.
- `looks.ts`: randomized villager appearance (`randomLook`, `childLook`).
- `npcs.ts`: `NpcData` (role: wanderer / villager / companion, tier, faction, random traits, 1–5 star `skills` incl. Combate and Diplomacia, request, home, job, hp, food, family fields, campaign `order`, player `command` and `stance`, `look`), `generateWanderer(rng, id, leavesAt, now)`, `productivity`, `soldierDamage`, `maxHpOf`, `Population` (faction-aware beds and recruiting; `villagers` is the player's only, `allVillagers` is everyone; `companions` travel with the player before the village and `settleCompanions` makes them villagers; `workers`, `assign`), `WandererSpawner`, and `payFrom`. Portuguese text is gendered, so labels go through `roleLabel`, `tierLabel` and `jobTitle`.
- `needs.ts`: hunger. `updateNeeds` drains satiety, eats stockpile meat and returns `starving` / `died` events; `updateNeedsFrom` eats from any `Larder` (companions eat from the player's bag). `foodDays` gives the HUD estimate.
- `animals.ts`: `SPECIES` (temper: skittish / defensive / aggressive, stats, population), serializable `AnimalData`, `AnimalSpawner`, `pickAnimalTile`.
- `player.ts`: `PlayerStats` (HP and regen, hunger `food` that drains and starves, XP and levels; `carryWeight` and `gatherSpeed` derive from level).
- `farms.ts`: planting areas (`plotRect`, `plotTileProblem`, `setPlot`/`clearPlot`, stored on the farm as `Building.plot`, claimed as territory), the farmer's `nextFarmTask`, `plant`, `ripen` (3 days) and `harvestCrop` (food + seeds). Field tiles are `Obj.Field` / `Crop` / `CropRipe`; grass tufts (`Obj.Grass`) give seeds by chance (`NodeDef.chance`).
- `dungeons.ts`: ruins (`map.dungeons`, laid by `generateMap` as `Obj.Ruin` walls around an `Obj.Chest`), their saved `DungeonState` (site, guardians, looted, `collapseAt`), `GUARDS`, `rollLoot`, and `pickRuinSite`/`placeRuin`/`removeRuin`. WorldScene spawns guardians (wolves/bears via Wildlife, bandit NPCs with no order); a looted ruin collapses and a new one appears elsewhere (`updateDungeons`).
- Bandits (`generateBandit`, faction `BANDITS` = -1, role `'bandit'`) are hostile to everyone (`WorldScene.atWar`); hordes come from the map edge (`updateBandits`, `spawnHorde`).
- `drops.ts`: items dropped on the ground (G), picked up with E, saved, expiring after 3 days.
- `orders.ts`: the player's `Command` to a companion or soldier (follow, hold a spot), `Stance` (defensive / neutral / aggressive) and `engagement` (how far they fight by stance).
- `crafting.ts`, `time.ts` (`GameClock`, `ambientAt`), `save.ts` (`SaveData`, versioned; `readSave` / `writeSave` take an injectable storage). Saves from `MIN_SAVE_VERSION` up load; migrate old ones in `WorldScene.create` (e.g. v6 saves get starter tools).
- Randomness is injected (`rng` parameters) so tests are deterministic.

### Entities and systems

- `src/world/path.ts`: A* (`findPath` with a goal predicate and a node budget).
- `src/entities/Npc.ts`: movement along A* paths plus the behaviour state machine, branching on the workplace job. Workers loop node → harvest → nearest own deposit. Hunters shoot prey and collect meat. Soldiers guard the barracks (`guard`) or, with an `order`, raid an enemy village (`raid`: towers first, then buildings). Companions and commanded soldiers follow the player or hold a spot (`commanded`), fighting by stance. Idle adult villagers help build unfinished sites of their village (`helpBuild`). Farmers plant and harvest their farm's plot (`farm`). Diplomats and merchants (`diplomat`) walk missions to another village (going → talking → returning); merchants pull a handcart. Smiths stand at the smithy while it can forge. Workers whose job needs a tool idle without one (`NpcWorld.toolFor`) and show it in hand. Everyone else goes inside their house at night (`indoors`: hidden and untargetable) and flees predators. It talks to the world only through `NpcWorld`, which `WorldScene` implements.
- `src/entities/Animal.ts`: straight-line movement with sliding collision. Skittish animals flee, defensive ones retaliate, aggressive ones chase within `aggroRange` (×1.4 at night) and give up past a leash. Dead animals stay as carcasses.
- `src/systems/Wildlife.ts`: owns all animals (spawning, updates, carcass rot, player melee, hunter shots, meat, HP bars). It talks to the scene through `WildlifeHost`.

### Scenes and UI

- `WorldScene` owns the world and its state, input, interaction priority (NPC > carcass > tile/building), combat (towers, `findHostile`, `damageBuilding`: halls are looted or conquered instead of destroyed), build mode, XP, rival-town AI (`updateTowns`), families, diplomacy and wars (`updateDiplomacy`: missions, daily AI, raids), trade (`marketOf`, `sendCaravan`, `updateTrade`), diplomats recruiting wanderers by each faction's `recruitPolicy` (`updateRecruiting`, missions of kind `'recruit'`), and save/load. Rival AI (`updateTowns`) is food-first (farms via `aiBuild`/`setupAiFarm`, `staffInOrder` with `JOB_PRIORITY`), then protection, then growth with a random per-village leaning. **Phaser reuses the scene instance on `scene.restart`** (loading a save, new game), so all per-game state is rebuilt in `init()`, never in field initialisers. `TitleScene` is the first scene: it starts World with `{ save, slot }` or `{ fresh: true }` (World never loads by itself). Saves live in slots (`save.ts`: `'auto'` + 1–10, `listSlots`, `latestSlot`; the pre-slot key is migrated to `'auto'`). Autosave writes `'auto'` every `AUTOSAVE_SECONDS` (10 min) and on page hide/close; `toTitle()` autosaves and returns to the title screen. When a tile's object changes, call `replaceObjectImage(i)`.
- `UIScene` is a screen-space overlay that restarts with the world. It removes the world-event listeners (`popup`, `toast`, `talk`, `building`) left by its previous run before adding new ones. It owns the HUD (resources with days of food, population, coins, clock, HP/level, toasts), the night tint and vignette, and the panels in `src/ui/`: inventory/hotbar, build menu (B), crafting (C), NPC card, building panel, minimap (N), full-screen territory map (M), village management (V: `ManagementUI` with tab renderers in `TradeTab`, `DiplomacyTab`, `DynastyTab`), and the pause menu (Esc, which pauses `World`). Panels set flags on `WorldScene` (`inventoryOpen`, `modalOpen`, `talkingTo`, `panelBuilding`) that freeze the player. Key handling in UIScene goes top-down: pause → building panel → NPC card → map → management → everything else.
- Tuning constants live in `src/config.ts`.
- Sound: `src/audio/sound.ts` (`sound.play(sfx)` synthesizes effects with Web Audio; `sound.setMood(...)` crossfades music from `public/audio/music/`, see `docs/CREDITS.md`). WorldScene sets the mood (battle/day/night) in `updateMusic`; TitleScene plays the title track.

## Verifying changes

Put rules in `src/game/` and test them with Vitest. For anything visual, run the dev server and check in the browser:

- In dev builds `window.game` is exposed. For example, `game.scene.getScene('World').stockpile.add('wood', 100)`. Private helpers such as `spawnWanderer()`, `recruit(id)` and `addBuildingView(buildings.place(...))` are reachable from the console for setting up scenarios.
- Simulate keys by dispatching `KeyboardEvent`s on `window` (key, code, keyCode). Holding T fast-forwards world time.
- The browser console keeps errors from earlier hot reloads, so watch for fresh ones with `addEventListener('error', …)`.
- Phaser's WebGL renderer fails with a 0×0 framebuffer if the canvas boots hidden, which is why `src/main.ts` passes explicit fallback sizes to `Scale.RESIZE`. If it still boots while the browser pane is hidden, reload once the pane is visible.
- A hidden browser pane throttles `requestAnimationFrame`, so the game stops updating. To simulate anyway, step the loop by hand: `game.step(t += 50, 50)` in a loop (hold T via a dispatched keydown to fast-forward).
- The game opens on the title screen: `game.scene.getScene('Title').play(null)` starts a fresh game (or `play('auto')`), and `game.scene.getScene('World').newGame()` restarts one.
