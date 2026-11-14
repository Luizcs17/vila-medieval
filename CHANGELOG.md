# Changelog

Each milestone from `docs/GDD.md` is a minor version.

## 1.4.0: Milestone 14, families and dynasties

- One game day is one year. Everyone has a surname and an age; wanderers arrive as adults (16–45). Children are drawn smaller, eat half and can't be hired until 16. After 65, villagers may die of old age.
- Single adults of the same village who live or work close together build affinity (shared traits help, clashing ones hurt) and marry at 100, moving in together when there's a bed.
- Couples sharing a house with a free bed and food have children (up to 4). Children take a parent's surname, ratings near their parents' average and sometimes a parent's trait. Rival villages grow the same way.
- The player can marry: talking to one of your villagers (E) raises their affinity with you once a day; at 60% the card offers "Pedir em casamento". Your children carry the dynasty name Valverde.
- Dinastia tab in village management: a family tree for your dynasty, each rival ruler's, and your village's founding families. The dead stay in the tree (†); rulers are framed in gold.
- Villager cards show full name, age, spouse, children and affinity with you. Save format v3.

## 1.3.0: Milestone 13, defences and soldiers

- New buildings: Paliçada (log wall, blocks animals and enemies), Portão (gate: your people walk through, animals and raiders don't), Torre de vigia (shoots aggressive animals and enemies within 6 tiles; claims 8 tiles of territory), Quartel (4 soldier slots). Walls and gates stay in placement mode so you can lay them in a row.
- Buildings have HP: animals blocked by walls chew on them, health bars appear when damaged, destroyed buildings free their tiles and territory. Hold E on your damaged building to repair it (1 wood per 10 HP, from what you carry or the stockpile).
- Soldiers patrol around the barracks day and night, charge hostiles within 8 tiles (up to 14 from the barracks) and fight. Damage is 1–3 from the new Combate rating; soldiers have +6 HP.
- New skill ratings: Combate and Diplomacia (diplomats arrive in milestone 15).
- Rival towns build a watchtower once they can afford one.

## 1.2.0: Milestone 12, territory map and village management

- M opens a full-screen map: terrain, each village's territory in its colour with strong borders, buildings, village names, villagers and wanderers, you, and a legend with population and land per village. The minimap is now toggled with N.
- V opens village management with tabs: Summary (population, beds, jobs, food days, territory, stock, rival villages), Villagers (table with job, skill ratings, hunger, HP; click opens the card) and Buildings (state and people; click opens the panel). Diplomacy and Dynasty tabs are reserved for the next milestones.

## 1.1.0: Milestone 11, rival towns and territory

- The map is now 128×128 with three rival villages (Pedra Alta, Vale Azul, Pinhal Dourado), each with a hall flying its colour, houses, workplaces and six villagers who work, eat and live with the same AI as yours. Rival towns build houses as they grow and staff their workplaces.
- Factions: buildings, villagers and stockpiles belong to a village. Workers deliver to their own village; rival buildings and people show their village name.
- Territory: every building claims land around it (hall 9, depot 5, others 4). You can only build on your own land, growing it from the border. The minimap tints each village's territory.
- Houses now have 4 beds. Wanderers who give up waiting may move to a rival town instead.
- Ground is baked into render-texture chunks, which keeps 60 fps on the bigger map. Wildlife scales with the map.
- The save format moved to v2 (older saves are ignored).

## 1.0.0: Milestone 10, save/load (v1 complete)

- The game saves to browser storage automatically (every 2 real minutes, at each new day, and when the page is hidden or closed) and loads the last save on start.
- Esc with nothing open pauses: Continue, Save, Load last save, New game (asks twice), plus a controls list.
- Saves include map changes, regrowth timers, buildings, stockpile, inventory (with durability), player HP/level/position, villagers (jobs, hunger, HP, positions) and animals. Saves from a different format version are ignored safely.

## 0.9.0: Milestone 9, crafting and progression

- Crafting menu (C): stone/iron axes and pickaxes, a spear and an iron sword. Materials come from what you carry first, then the stockpile.
- Tools work from the selected hotbar slot (1–9): axes speed up wood, pickaxes stone and iron (1.6× stone, 2.4× iron). Iron now needs a pickaxe.
- Weapons and tools deal more damage (spear 3 with longer reach, sword 5). Everything has durability and breaks.
- Tools don't stack, keep their durability when moved, and are never lost when you deposit or get knocked out.
- Player XP from gathering, building, recruiting, crafting and hunting. Each level: +1 max HP, +3 kg carry, +5% gathering speed (up to level 15). Level and XP bar shown by the HP bar.

## 0.8.0: Milestone 8, villager needs

- Villagers get hungry (satiety 0–100, empty after a day) and eat meat straight from the stockpile, about 2 per day. Frugal eats 30% less, Apetite grande 40% more.
- With no meat: a warning toast, a red meat icon over the villager, half productivity, no healing; after 1.5 days at zero they die (their bed and job free up).
- The resource bar shows how many days the meat lasts (orange under 2 days, red under 1).
- F eats a meat you carry to heal 2 HP.
- The villager card shows hunger.

## 0.7.0: Milestone 7, animals, combat and minimap

- Wildlife: rabbits and deer (run away), boars (fight back when hurt), wolves and bears (attack people nearby; more wolves at night). Populations refill over time, away from the village.
- Combat: Space swings at the nearest animal; animals have HP bars when hurt. Player has 10 HP that regenerates; at 0 you wake up at the village and lose carried resources.
- Carcasses hold meat: E takes it (weight permitting). Carcasses rot after a day.
- Hunters (Cabana do caçador) track prey near the hut, shoot it, collect the meat and deliver it.
- Villagers have HP, run home from attacking animals, heal over time and can be killed.
- Minimap in the bottom-right corner (M toggles).

## 0.6.0: Milestone 6, jobs

- Villagers have 1–5 star ratings in Corte de lenha, Cantaria, Mineração and Caça (tier sets the ratings; traits are now fully random).
- Work speed = rating multiplier (0.75×–1.75×) × trait effects (profession trait ×1.5, Incansável ×1.2, Sem pressa ×0.8).
- E on a finished workplace opens a panel to hire/dismiss workers (2 slots, best candidates first); E on a house lists residents.
- Workers walk to resource nodes near their workplace, harvest up to 5 units, deliver to the nearest stockpile/depot and repeat. Everyone goes home at night.

## 0.5.0: Milestones 1–5

- Fixed isometric map, WASD movement, camera and zoom.
- Hold-E gathering of wood, stone and iron; central stockpile.
- Minecraft-style inventory limited by weight (40 kg).
- Day/night cycle; resources regrow.
- Build menu (B), placement and construction of 6 building types.
- Wandering NPCs with tiers and traits; recruitment into houses.
- Dev pipeline: Biome lint/format, `npm run check`, GitHub Actions CI.
