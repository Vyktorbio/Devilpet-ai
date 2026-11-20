# DevilPet neural engine — Rust

Este diretório é um **motor neural independente** do jogo web. O arquivo original `neural-engine.js` não é alterado. Ainda não está conectado ao site nem ao Cardputer.

## Escopo real

O motor portado é uma **simplificação inspirada em Drosophila**, com:
- Circuito esparso com 30 entradas sensoriais, 48/160/420/1000 Kenyon cells, sinais MBON e regras de elegibilidade, plasticidade e consolidação.
- Circuito complementar ORN/PN/KC para odores e preferências espaciais.
- Gerador pseudoaleatório Mulberry32 compatível com o JavaScript e 4 arquiteturas originais.
- Estado completo para retomada exata do **motor Rust** e importação de checkpoints incompletos do navegador.
- Formato `devilpet-portable-v1`, com **genoma digital separado da memória aprendida**.
- Perfil circadiano configurável, *ainda não integrado ao mundo 3D*: o aplicativo fornece o horário local, e o componente pode decidir se é a janela de descanso.

**Não** simula um conectoma completo do FlyWire, nem gânglios do cordão nervoso ventral, nem motores biológicos das asas/pernas. Não mede consciência.

## Executar

Requer Rust estável e Cargo:

```sh
cd rust/devilpet_brain
cargo test --all-targets
cargo run --bin devilpet-reference -- demo
```

### Converter uma mosca salva no navegador

Primeiro baixe um backup em **Exportar backup JSON** na página DevilPet. Em seguida:

```sh
cargo run --bin devilpet-reference -- import-browser ~/Downloads/devilpet-backup.json minha-linhagem > mosca-portatil.json
cargo run --bin devilpet-reference -- validate mosca-portatil.json
```

O adaptador importa as sinapses do backup antigo, inclusive os pesos LTM e a memória de odor. Checkpoints antigos não armazenavam voltagens, elegibilidade ou memória de trabalho, portanto **não existe garantia de retomada exata do próximo disparo**. A rede KC do navegador era inicializada com seed 42, diferente do estado RNG salvo.

### Cruzamento digital de genomas

```sh
cargo run --bin devilpet-reference -- breed mosca-a.json mosca-b.json filhote-1 123 > filhote.json
```

O filhote herda **arquitetura e cronotipo** de seus pais (escolha de atributos entre os genomas), mas começa com sinapses **sem aprendizado**. Misturar sinapses LTM de dois animais treinados não seria cruzamento genético e por isso não é feito. Como modelo digital inicial de herança, não constitui uma simulação de reprodução biológica.

### Duas moscas na mesma arena

Cada instância Rust pode ter seu próprio motor e conjunto de pesos sem interferir na outra. **Uma arena multiplayer/coexistência ainda precisará ser construída** no ambiente do jogo. Importar o JSON em Rust não modifica o pet que está aberto no navegador.

### Ciclo de sono

`CircadianProfile::is_night(local_hour)` determina a janela de sono a partir da hora local enviada pelo aplicativo. Fuso IANA é gravado como metadado; sua conversão deve ser realizada por quem roda o pet. A função não força o sono nem consolida memórias sozinha. A consolidação continua usando o parâmetro `consolidate` da mesma regra neural, quando o ambiente solicitar.

## Testes e integridade

- `tests/golden_browser.json` foi gerado executando o arquivo JavaScript existente sem alterações, para todos os tamanhos de arquitetura, com a mesma semente e sequência de estímulos.
- `tests/js_equivalence.rs` compara RNG, saídas MBON, telemetria, pesos e passos contra os valores do JavaScript, com tolerância numérica.
- Testes adicionais verificam replay determinístico, preservação de estado, importação, sono e criação de linhagens.
- A publicação do site continua usando `neural-engine.js`, nunca este motor Rust.

O algoritmo em Rust pode ser compilado para alvos nativos e, futuramente, WASM. Para o Cardputer ESP32-S3 ainda precisamos de uma versão apropriada ao alvo e à memória disponível; esta crate padrão Rust com serde e testes é inicialmente direcionada a PCs.
