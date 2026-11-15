# Changelog

Each milestone from `docs/GDD.md` is a minor version.

## 1.15.0: Milestone 25, trading in person and companions

- Talk (E) to someone from another village: their card has "Comerciar". The trade window lists what their village sells and what you carry that it would buy, at its market prices (supply moves them), paid with your coins. Worn tools sell for less. Not with villages at war with you.
- Before you have a village, wanderers can join you as companions (up to 4): "Chamar para o grupo" pays their request, no bed needed. Companions follow you (catching up if left far behind), fight hostiles near them as long as the fight stays near you, and don't go indoors at night.
- Companions eat meat from your bag (then from what's stored in your house) and can starve. Their card shows HP and hunger. You give them a weapon and armour from your bag by clicking (their old one comes back to you).
- When you claim land, your companions become villagers of the new village. Villagers without a home now move into any free bed of their village by themselves (also after a house is demolished).
- Fighters whose target stands on a tile they can't step on now reach it from an adjacent tile.

## 1.14.0: Milestone 24, survival start

- New games start with nothing: no hall, no land, no stock and no coins. Existing saves keep their village.
- The player gets hungry. A bar next to HP shows hunger (70 a day). F eats one meat: +35 satiety and +2 HP. When hungry you get a warning. At zero you don't regenerate and lose 1 HP every 12 s; being knocked out by hunger wakes you with a little food.
- Before you have a village, the B menu offers only "Sua casa" (12 wood, 4 stone, on land nobody owns). Once it's built, it also offers "Reivindicar terras" (30 wood, 15 stone, within 12 tiles of your house, away from other villages). Claiming raises the Salão: your village is born and everything else unlocks (other buildings, V, diplomacy).
- Your house is your larder before the village: its inventory is your stock, so you can store materials there across trips (claiming pays from your bag + the house). After claiming, that stock is the village's, at the Salão.
- Your house: you wake up there after being knocked out, and at night its panel lets you sleep until morning (full HP, a bit hungrier).
- Until you have a village, rival villages ignore you in diplomacy and don't raid. Wanderers appear around you.

## 1.13.0: Milestone 23, colonies

- New in the B menu: "Fundar colônia" (100 wood, 80 stone, 10 iron, 10 meat). Place a new hall far from every village (at least 24 tiles from any village centre, with no claimed land within 10 tiles). It becomes a colony of yours, with its own territory, its own stock (it starts with 30 wood, 20 stone and 10 meat) and its own people. Colony names: Nova Esperança, Vale do Corvo, Monte Claro and so on.
- Colonies share your relations: your wars, peace and alliances are theirs too, and enemies raid them.
- Buildings placed on a colony's land belong to that colony and are paid from what you carry first, then the colony's stock. The colony hall is its deposit point: E there opens its stock.
- To settle a colony, build a house there and open its panel. "Mudar para cá" lists adults from your other villages; they leave their job and walk to their new home.
- The HUD shows the stock and population of the village you're standing in. V → Resumo and V → Aldeões get a village selector.
- If an enemy takes a colony's hall, only that colony is lost (its land, buildings and people). Your home village is still only plundered, never conquered.
- Saves keep colonies (name and founder).
- Not done yet: caravans between your own villages. Move goods by hand for now (the hall's stock panel).

## 1.12.0: Milestone 22, tools in hand and mouse combat

- Tools and weapons show in people's hands: the player holds the selected hotbar tool or weapon, workers hold their job tool (axe, pick, spear) and swing it while working, and soldiers carry their weapon.
- WASD still moves the player, but they now face the mouse.
- Attacks are a left click on the world, aimed toward the mouse: only animals in front of the swing (or touching you) are hit. Space still works as a shortcut. Gathering stays on E. Clicks on panels or in build/demolish mode don't attack.

## 1.11.0: Milestone 21, smithy, tools, weapons and armour

- New building: Ferreiro (smithy; 20 wood, 20 stone). Employs up to 2 smiths, rated by the new Forja skill. In its panel you queue up to 8 items; each one takes its materials from the village stock when work starts and a set time to forge (40 s stone tools and spear, 70 s iron tools, 90 s sword, 60 s leather armour, 120 s iron armour, faster with better smiths). Finished items go to the village stock. Click a queued item to cancel it (started work is refunded).
- Productive buildings need tools in their inventory, one per worker: lumberjack an axe, quarry and mine a pick, hunter a spear. Without one, the worker stands idle ("Sem ferramenta no prédio"). Iron tools work faster than stone ones, and tools wear out with use. The panel shows "Ferramentas n/slots" with a "Trazer do estoque" button.
- Soldiers get weapons and armour: in the barracks panel, click a soldier's weapon or armour button to cycle through what's in the barracks or the village stock. Weapons add their damage; whatever a soldier takes off goes back to the barracks.
- Armour: leather (absorbs 30% of damage, 60 hits) and iron (55%, 150 hits). The player wears the best armour they carry automatically.
- New resource: leather (Couro). Dead deer, boars, wolves and bears can be skinned with E; hunters skin their prey and the leather goes to the stock.
- Rival villages start with tools and spears, and replace worn tools from their stock.
- Old saves still load: existing workplaces receive one basic tool per job slot.

## 1.10.0: Milestone 20, storage everywhere

- Every building has its own inventory (saved with the game). Workplaces and houses show an "Inventário" button in their panel; towers, walls and gates open theirs with E.
- The central stock is now manageable: E at the hall, a depot or a market opens the village stock (stockpile resources and the tool warehouse) next to what you carry. Take 1, 10 or everything (weight permitting) and store 1 or everything; E inside stores all your resources at once.
- Tools come out of storage in full condition; worn tools (under 75%) can't be stored.
- Fix found by the new tests: storing "everything" no longer turns into NaN.

## 1.9.0: Milestone 19, hunters, nights indoors and demolition

- Fix: hunters now actually bring meat. They search 24 tiles around the hut (was 14, while animals spawn 14+ tiles from villages), shoot from 6 tiles (farther than deer and rabbits bolt) and arrows deal 2 damage. In a 2-day test with natural wildlife, two hunters delivered 11 meat.
- Villagers (not soldiers, not travelling diplomats/merchants) go inside their house at night and come out at dawn; they also take shelter inside when fleeing a predator, and stay in while it's near. People indoors are hidden and can't be attacked.
- Demolition: X or the "Demolir" button in the B menu. Point at one of your buildings and click twice to demolish it: unfinished sites refund everything, finished buildings half. Residents and workers lose their house/job, territory is recomputed. The hall can't be demolished. Roads are removed with one click (1 stone back).
- The B menu now uses two columns.

## 1.8.1: Dev and prod servers

- `npm run prod` serves a stable build on http://localhost:4173 from a separate copy of the project (git worktree at `main`), so the game can be played while development continues on http://localhost:5173. `npm run prod:update` moves it to the latest `main` and rebuilds it. Prod and dev keep separate save games.
- `docs/BACKLOG.md` lists the requests waiting for approval.

## 1.8.0: Milestone 18, coins, markets and caravans

- Currency: every village has a treasury in coins (moedas), shown in the HUD. You start with 60; rivals with 120.
- Mercado (market, the trade centre): employs merchants (rated by Diplomacia, which also makes them haggle ±4% per star), works as a deposit point, and has a warehouse for tools: E there stores the good-condition tools you carry; take them back in V → Comércio.
- Prices follow supply at each market (0.6×–1.8× base; markets pay 90% and charge 110%), and every unit sold lowers the next price.
- Caravans: in V → Comércio choose a destination market, what to sell and what to buy, and send a merchant. They walk the roads with a handcart, trade at the destination, and come back with coins and goods (unsold goods return).
- Rival villages have markets and merchants, forge tools from their iron, stone and wood, and send caravans with their surplus to other markets at peace, yours included. Standing orders ("Mercadores visitantes") say what visiting merchants may buy from you and what you'll buy from them.
- Rival villages start with 10 villagers and three houses. Save format v6.

## 1.7.0: Milestone 17, roads

- Cobbled roads (Estrada, 1 stone per tile, placed instantly; B menu keeps placing so you can lay a line). They can leave your territory to reach other villages, but not cross into theirs.
- Walking on a road is 40% faster for you and villagers, and pathfinding prefers roads (they cost 0.6 of open ground), so traffic follows them.
- New games start with old roads connecting each village to its nearest neighbours.
- Roads show on the minimap and the full map; trees don't regrow on them; buildings can be placed over them.

## 1.6.0: Milestone 16, dark medieval look

- Darker, earthier palette for ground, water, trees and rocks; dim warm days, deeper nights and a vignette around the screen.
- Half-timbered houses with thatch, slate and plank roofs, and weathered walls; darker palisades and stone.
- Medieval typography: bundled MedievalSharp (titles) and Alegreya (text) fonts, loaded before the game starts; dark oak panels with bronze trim and parchment-coloured text.
- Villagers look different: skin tone, hair colour and style (short, long, tied, bald), beards, hoods, caps, straw hats, aprons, and 12 tunic and 5 trouser dyes, randomized per person. Children inherit skin and hair from their parents.
- Save format v5.

## 1.5.0: Milestone 15, diplomacy, war and conquest

- Relations with every village (-100..100; peace, alliance, war). They drift toward neutral, shared borders cause friction, and the AI declares wars, makes peace and forms alliances among the villages. Toward you it only proposes; answer in V → Diplomacia.
- Embaixada (new building) employs diplomats, who walk to the other village: carry a gift (raises relation, more with a better Diplomacia rating), propose an alliance (needs +40) or peace. The success chance is shown. Diplomats on a mission are never attacked.
- Declaring war is instant, and allies on both sides join. Warring villages send their soldiers on raids; you can send yours (Attack / Recall). Raiders take out towers first, then batter buildings. Reaching your hall loots 30% of your stockpile; taking a rival's hall **conquers** it (buildings, villagers and stock become the winner's). AI villages can conquer each other.
- Rival villages start with a barracks and soldiers (8 villagers), build barracks when threatened, and react immediately to war. Halls have 500 HP.
- Fix: rival workplaces now respect their slot limits.
- Save format v4.

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
