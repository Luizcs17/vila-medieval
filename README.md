# Vila Medieval

Construtor de vila medieval isométrico. Você começa sem nada: sobrevive, constrói sua casa, reivindica terras e faz a vila crescer, enquanto três vilas rivais trabalham, comerciam, guerreiam e crescem com a própria IA.

**Jogar no navegador:** https://luizcs17.github.io/vila-medieval/

## Controles

- WASD: andar · Shift: correr · mouse: mirar · clique: atacar
- E: coletar, construir, falar, usar · F: comer · G: largar item
- B: construir · C: criar · I: inventário · V: vila · M: mapa · N: minimapa
- F1: ordens rápidas · T (segurar): acelerar o tempo · Esc: menu

O jogo salva sozinho a cada 10 minutos (Autosave) e tem 10 espaços de save. Os saves ficam no seu navegador.

## Desenvolvimento

TypeScript + Phaser 3 + Vite. Toda a arte é gerada pelo código.

```bash
npm install
npm run dev
```

`npm run check` roda typecheck, lint e testes. Cada envio para `main` publica o jogo no GitHub Pages.

## Créditos

Músicas (via OpenGameArt.org):

- "Fantasy Orchestral Theme" — Joth (CC0)
- "Majesty" — Kistol (CC0)
- "Тема королевства", "Легенда 1" e "СДП (средневековая тема 1)" — Alexandr Zhelanov (https://soundcloud.com/alexandr-zhelanov), licença [CC-BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- "Medieval: Battle" — RandomMind (CC0)

Fontes: MedievalSharp e Alegreya (SIL Open Font License). Feito com [Phaser](https://phaser.io).
