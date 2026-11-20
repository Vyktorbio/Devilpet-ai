# DevilPet — arquitetura de execução segura

A prioridade deste projeto é preservar a **mente treinada**, executar o pet no navegador e permitir experimentos reprodutíveis. Rust não deve ser usado apenas por ser Rust: ele representa o circuito computacional; JavaScript controla o mundo, a interface e a persistência.

## Responsabilidades atuais

| Camada | Implementação | Responsabilidade |
| --- | --- | --- |
| Domínio / referência | `neural-engine.js` | Modelo esparso KC/MBON e circuito olfativo original. Não é reescrito por mudanças na interface. |
| Domínio / alto desempenho | `rust/devilpet_brain/src/{sparse,odor,rng}.rs` | Tradução do mesmo modelo e RNG, sem cenas nem DOM. |
| Adaptador WebAssembly | `rust/devilpet_brain/src/wasm.rs` | API do motor Rust consumida pelo navegador, inclusive RNG de movimento. |
| Orquestração | `wasm-activate.js` | Validação, ativação explícita, migração atômica dos dois circuitos, recuperação e diagnóstico. |
| Ambiente e interface | `index.html` | Física do corpo, estímulos, câmera 3D, controles, ritmo metabólico e integração inicial. |
| Observação | `ethology*.js` | Diário e gráficos a partir de dados simulados, sem alterar os pesos neurais. |
| Persistência | `drosophila_3d_trainer_v1` | Checkpoint legado (compatível) e estado opcional completo do Rust. |
| Distribuição | GitHub Actions + Pages | Recompila, testa num navegador, inclui Three.js local e publica JS+WASM. |

## Contratos

1. O site **inicia em JavaScript**, sem depender de WebAssembly, de CDN ou do carregamento do Rust.
2. Rust é **opcional**. O botão de ativação só é habilitado depois de autoteste da resposta neuronal, peso, RNG, reforço olfativo e checkpoint. Nenhum teste toca na mosca treinada.
3. Os dois circuitos são migrados em conjunto; se a conversão falhar, ambos permanecem como estavam.
4. Se houver erro do Rust durante a simulação, a ponte tenta recuperar o estado no JavaScript. Em falhas irrecuperáveis, a simulação pausa sem zerar a memória.
5. `neural-engine.js` é a referência para os testes de equivalência; Rust deve manter as mesmas regras antes de ativar otimizações.
6. O backup atual continua legível. O estado completo Rust é campo opcional; exportações antigas continuam funcionais.
7. O gerador de números aleatórios tem **o mesmo estado e a mesma função `next()`** nos dois motores. O mundo 3D e o cérebro compartilham esse fluxo na simulação atual.
8. Não alegar que o modelo representa conectoma completo, cordão nervoso ventral ou consciência. É um circuito inspirado em insetos.

## Pipeline obrigatório para publicação

- `cargo test --all-targets`: regras neurais, reprodução determinística, snapshots e equivalência com o JavaScript.
- Teste do módulo WebAssembly compilado, executando as duas redes, reforços e restauração.
- `runtime-smoke.mjs`: passagem de JS para Rust, compatibilidade de pesos, `rng.next()`, recuperação e retorno para JS.
- `browser-smoke.mjs`: **Chromium real**, cenário 3D renderizando, JS como padrão, Rust ativado, simulação avançando, retorno seguro a JS.
- O deploy do Pages só ocorre quando todas as etapas são aprovadas.

## Próxima refatoração sem quebrar a mosca

A cena, a física e a UI ainda compartilham um script extenso em `index.html`. A migração futura deve extrair *somente* o código de apresentação para módulos separados (`world`, `input`, `render`, `persistence`), um de cada vez, com testes de regressão. Essa refatoração estrutural não é justificativa para mudar sinapses nem reiniciar a linhagem.

O cronotipo baseado em horário real e o arquivo «genoma + mente portátil» existem parcialmente na crate Rust, mas **ainda não estão ligados ao pet web**; precisam de integração de produto, testes de sono e migração de dados antes de serem expostos.
