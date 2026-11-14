# Vila Medieval — Documento de Design (v1)

Nome provisório. Atualizado em 14/11/2026.

## Conceito

Construtor de vila medieval tranquilo, em 2D isométrico e pixel art. Você controla o protagonista andando pelo mapa (WASD), em vez de uma câmera "mão de Deus". A população **só cresce recrutando NPCs** que aparecem aleatoriamente pelo mapa.

## Pilares

1. **Você está no mundo.** O protagonista anda, coleta, constrói e conversa com as próprias mãos.
2. **Cada pessoa importa.** NPCs têm traços, necessidades e podem morrer.
3. **Ritmo calmo.** O desafio é organizar a vila. Na v1, o único perigo são animais.

## Ciclo principal

explorar → coletar → construir → recrutar → designar NPCs a prédios → a vila produz → liberar mais coisas

## Decisões da v1

| Tema         | Decisão                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Visual       | Isométrico, pixel art provisória (gerada em código)                                                                                                                                                                                                                                                                                                                                                          |
| Plataforma   | PC (Steam no futuro). Hoje roda no navegador; depois empacotamos com Electron/Tauri                                                                                                                                                                                                                                                                                                                          |
| Controle     | WASD. O protagonista coleta recursos pessoalmente                                                                                                                                                                                                                                                                                                                                                            |
| Protagonista | Evolui (ferramentas, habilidades)                                                                                                                                                                                                                                                                                                                                                                            |
| Recrutamento | Exige casa livre; NPCs melhores exigem coisas melhores                                                                                                                                                                                                                                                                                                                                                       |
| Andarilhos   | O primeiro aparece logo no início; depois, um a cada ~⅓ de dia (máx. 3 no mapa), a 12–26 quadrados da vila. Um aviso diz a direção ("apareceu a nordeste da vila") e um "!" na cor do nível fica sobre a cabeça. Se não forem recrutados, vão embora após 1,5 dia                                                                                                                                            |
| Níveis       | Comum (60%): 1 traço qualquer, pede só uma cama. Habilidoso (30%): 1 traço de profissão, pede uma cama + 10 madeira, 8 pedra ou 6 madeira e 4 pedra. Mestre (10%): traço de profissão + Incansável ou Frugal, pede uma cama + ferro (ex.: 5 ferro e 10 pedra)                                                                                                                                                |
| Conversa     | E perto do andarilho abre um cartão com traços, pedido (✓/✗) e prazo. O pedido pode ser pago com o que você carrega **e** com o estoque (primeiro o que carrega). Enter recruta, Esc fecha. Recrutado, ele vai a pé (com desvio de obstáculos) até a casa onde ganhou cama e passa a viver por perto                                                                                                         |
| Moradia      | Cada Casa pronta tem 2 camas. O topo da tela mostra "População aldeões/camas"                                                                                                                                                                                                                                                                                                                                |
| Traços       | Força no machado, Olho para pedra, Faro para ferro, Mira certeira (+50% na profissão), Incansável (+20% em tudo), Frugal (come menos), Apetite grande (come mais), Sem pressa (-20%). Os efeitos entram nos marcos 6 e 7                                                                                                                                                                                     |
| NPCs         | Têm traços e necessidades (comida, moradia). **Morrem** se faltar comida                                                                                                                                                                                                                                                                                                                                     |
| Trabalho     | Designando o NPC a um prédio (ex.: cabana do lenhador)                                                                                                                                                                                                                                                                                                                                                       |
| Recursos     | Madeira, carne (caça), pedra, ferro (minerado direto). Regeneram com o tempo                                                                                                                                                                                                                                                                                                                                 |
| Estoque      | Central. O protagonista leva os recursos do inventário até o estoque (tecla E deposita tudo)                                                                                                                                                                                                                                                                                                                 |
| Inventário   | Estilo Minecraft: hotbar de 9 espaços sempre visível + mochila de 18 espaços (I ou Tab). Pilhas de até 20. Clique pega/solta/troca, botão direito pega metade/solta um, Shift+clique move entre hotbar e mochila. Teclas 1-9 escolhem o espaço da hotbar (será usado pelas ferramentas)                                                                                                                      |
| Peso         | O limite do que o protagonista carrega é o **peso**: 40 kg. Madeira 2 kg, pedra 3 kg, ferro 4 kg, carne 1 kg (≈ 20 madeiras, 13 pedras ou 10 ferros). Carregar mais pode ser uma evolução do protagonista                                                                                                                                                                                                    |
| Construção   | B abre o menu. Escolha o prédio, posicione com o mouse (verde = pode, vermelho = motivo) e clique. O custo sai do **estoque central** na hora e surge uma obra; o protagonista segura E na obra para construir                                                                                                                                                                                               |
| Prédios      | Casa 2×2 (20 madeira, 10 pedra; moradia para 2). Cabana do lenhador 2×2 (15 madeira, 5 pedra; perto de árvores). Pedreira 2×2 (20 madeira; perto de pedras). Mina 2×2 (20 madeira, 15 pedra; perto de ferro). Cabana do caçador 2×2 (15 madeira, 5 pedra). Depósito 1×1 (10 madeira, 5 pedra; outro ponto para guardar no estoque central). "Perto" = até 6 quadrados. Pode-se construir sobre tocos e mudas |
| Coleta       | Segurar E perto do recurso. Árvore: 4 madeiras (vira toco); pinheiro: 5; pedra: 4 pedras; ferro: 3. Pedras e ferro somem quando acabam                                                                                                                                                                                                                                                                       |
| Regeneração  | Toco → muda (metade do tempo) → árvore: ½ dia; pinheiro: ⅝ dia; pedra: 1 dia; ferro: 1½ dia. Não reaparece em cima do jogador                                                                                                                                                                                                                                                                                |
| Dia e noite  | Um dia dura 8 minutos reais. Começa às 07:00. Amanhecer 05:00–08:00, entardecer 17:30–20:30. Segurar T acelera o tempo 20× (ferramenta de teste)                                                                                                                                                                                                                                                             |
| Mapa         | Fixo (semente constante)                                                                                                                                                                                                                                                                                                                                                                                     |
| Tempo        | Ciclo de dia e noite                                                                                                                                                                                                                                                                                                                                                                                         |
| Perigo       | Apenas animais perigosos                                                                                                                                                                                                                                                                                                                                                                                     |
| Objetivo     | Infinito                                                                                                                                                                                                                                                                                                                                                                                                     |

## Fora da v1 (futuro)

- Outras cidades, diplomacia e conflito. O fim do jogo futuro é **conquistar todas as vilas**.
- Agricultura / fazendas
- Estações do ano
- Cadeias de produção (minério → fundição → ferro)
- Arte final

## Marcos de desenvolvimento

1. ✅ **Andar pelo mapa**: mapa isométrico fixo, colisão, câmera, zoom
2. ✅ **Coleta manual de recursos + estoque + HUD de recursos** (a carne vem da caça, marco 7)
3. ✅ **Regeneração de recursos + ciclo de dia e noite + inventário estilo Minecraft**
4. ✅ **Construção de prédios + limite de carga por peso** (os prédios de trabalho só ganham função no marco 6, com os aldeões)
5. ✅ **NPCs aparecendo pelo mapa + recrutamento** (casa livre, pedidos por nível, traços definidos)
6. ✅ **Notas de habilidade + designar aldeões a prédios + produção automática**
7. ✅ **Animais neutros e agressivos + combate + caça + minimapa** (antecipado: a carne vem da caça e é a comida da vila)
8. ✅ **Fome dos aldeões, morte por fome e efeitos dos traços**
9. ✅ **Crafting de ferramentas e armas + evolução do protagonista (XP e níveis)**
10. Salvar e carregar + menu de pausa
