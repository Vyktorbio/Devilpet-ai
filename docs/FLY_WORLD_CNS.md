# DevilPet — mosca, mundo 3D e conectoma real (arquitetura)

O projeto separa três responsabilidades: ambiente/3D, animal/sensores e controlador neural. O cérebro recebe observações sensoriais, não coordenadas de objetos ou alvos.

## Componentes

| Camada | Arquivo | Responsabilidade |
| --- | --- | --- |
| Ambiente 3D | environment/world3d.js | Cena, câmera, luzes, renderer e resize |
| Estado do mundo | environment/world-state.js | Comida, obstáculos, poleiros, luz e objetos, sem Three.js |
| Sensores | fly/sensors.js | Antenas, visão, tato, paladar, mecanorreceptores, propriocepção, fluxo de ar e relógio |
| Mosca | fly/agent.js | Interface independente de renderizador que lê sensores e chama o motor neural |
| Cérebro reduzido | neural-engine.js ou Rust/WASM | Motor atual da diabinha, com suas sinapses e pesos salvos |
| Ponte CNS | fly/connectome-bridge.js | Contrato HTTP: sensores → conexões reais → comandos motores, com ativação voluntária |
| Leitor CNS Rust | rust/connectome_engine | Grafo CSR original completo, versão, pesos de sinapse e IDs |
| Portas neuronais | rust/connectome_engine/src/ports.rs | Verifica IDs de neurônios anotados e a procedência do mapeamento |

A física do corpo, a geometria decorativa e partes da UI ainda estão no index.html. A separação do Three.js e da percepção já foi feita; a extração de toda a física é a próxima refatoração. O arquivo neural-engine.js original NÃO foi alterado.

## Órgãos sensoriais digitais

A mosca percebe gradientes de odor nas duas antenas; intensidade e direção da visão; proximidade e contato de obstáculos; contato com alimento; altitude, orientação e reservas do corpo; vento relativo; e hora local.

Esses sensores são simulações geométricas em unidades virtuais, não medidas calibradas de fotorreceptores, sensilas ou neurônios da mosca real. A tradução das cinco pistas originais e dos quatro odores mantém a mesma matemática para preservar a compatibilidade do comportamento.

## Como conectar o conectoma completo

Escolha uma única reconstrução CNS de 2026: **Male CNS v1.0** (macho) ou **BANC v888** (fêmea). Não combine IDs de preparações diferentes.

1. Baixe o conectoma completo nas fontes oficiais e compile seu grafo, conforme connectomes/README.md.
2. Baixe as anotações oficiais e identifique os neurônios sensoriais e motores corretos, incluindo função e lateralidade.
3. Preencha uma cópia de connectomes/ports.template.json com IDs reais, anotações, evidências e revisão. Um template vazio é rejeitado pelo serviço.
4. Execute no computador:

~~~sh
cargo run --release --manifest-path rust/connectome_engine/Cargo.toml \
  --bin connectome-serve -- \
  --graph data/compiled/male-cns-v1.0 \
  --ports data/ports-reviewed.json \
  --bind 127.0.0.1:8326
~~~

5. No DevilPet, abra Arquiteturas neurais → Conectoma real. Clique Conectar grafo e, **somente após receber atividade motora real no grafo**, Ativar controle CNS.

O serviço fornece GET /health e POST /step, aceita somente origens confiáveis e liga em loopback. Para acesso remoto use HTTPS, autenticação e um proxy adequado. Alguns navegadores podem bloquear uma página HTTPS chamando HTTP de localhost; o proxy HTTPS também resolve essa limitação.

## O que já temos de dados oficiais

O GitHub Actions baixou a tabela pública de **anotações** do Male CNS 2026: 211.577 corpos/segmentos, dos quais 17.937 são candidatos sensoriais e 925 candidatos motores por triagem textual. SHA-256, fonte e condições estão em connectomes/official-annotations-audit.json. A triagem não atribui automaticamente motores a asas ou pernas.

**Ainda não foi baixada nem incorporada à página a tabela completa de conexões (~1,1 GB).** O serviço necessita do arquivo compilado e de um mapeamento anatômico revisado para dirigir o pet. Nenhum ID de neurônio foi inventado.

## Limite científico

A propagação ao longo de arestas reais de um conectoma **não é por si só a fisiologia completa da mosca**. Sinais inibitórios/excitatórios, modelos de membrana, neuromodulação, plasticidade distribuída e a resposta efetiva dos músculos não podem ser deduzidos somente das contagens de sinapses. A ponte é uma plataforma experimental, não uma demonstração de consciência ou de equivalência biológica.

## Integridade

- O DevilPet abre com o cérebro reduzido mesmo sem servidor CNS.
- O modo CNS é voluntário; se a saída vencer ou o servidor falhar, retorna ao controlador reduzido.
- Os pesos aprendidos e o checkpoint original permanecem compatíveis.
- Testes independentes verificam a equivalência sensorial, cálculo CNS com grafo fictício **claramente marcado como teste**, e a abertura do jogo real num navegador Chromium.
