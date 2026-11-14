# Changelog

Each milestone from `docs/GDD.md` is a minor version.

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
