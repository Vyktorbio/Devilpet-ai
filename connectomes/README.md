# DevilPet — conectomas completos (2026)

Este módulo é independente da mosquinha que já funciona no navegador. Ele utiliza **conectomas anatômicos reais**, enquanto o cérebro JavaScript original continua como motor reduzido do jogo. A existência de um conectoma não equivale à existência de uma simulação fisiológica completa.

## Bases científicas

As fontes, versões e licenças são registradas em [datasets.json](./datasets.json). Os datasets prioritários de 2026 incluem **cérebro, lobos ópticos e cordão nervoso ventral do mesmo indivíduo**:

| Conectoma | Escopo | Acesso oficial |
|---|---|---|
| BANC v888, 2026 | Fêmea adulta, cérebro + VNC, 158.262 neurônios no catálogo Codex | [Nature](https://www.nature.com/articles/s41586-026-10735-w) · [Dataverse](https://doi.org/10.7910/DVN/7WTH1N) |
| Male CNS v1.0, 2026 | Macho adulto, cérebro + VNC, aproximadamente 166,7 mil neurônios | [Cell](https://doi.org/10.1016/j.cell.2026.08.015) · [Janelia](https://male-cns.janelia.org/download/) |
| FlyWire FAFB v783 | Cérebro adulto de fêmea, sem VNC | [Zenodo](https://zenodo.org/records/10676866) |
| MANC | Cordão nervoso ventral de macho, em outra preparação | [Janelia](https://www.janelia.org/project-team/flyem/manc-connectome) |
| Hemibrain, FANC | Conjuntos históricos e comparadores de cobertura distinta | Links no catálogo |

Não concatenar dados de animais diferentes: os IDs são locais a cada dataset e versão.

## Rodando o Male CNS real no computador

Requer Python 3.10+, NumPy e PyArrow, Rust/Cargo e alguns GB de disco. A tabela oficial completa de conexões tem aproximadamente 1,1 GB, portanto não é apropriada para download automático no smartphone.

~~~sh
python -m pip install "numpy>=1.26,<3" "pyarrow>=18,<26"
mkdir -p data/male-cns-v1.0
curl -fL --retry 4 -C - -o data/male-cns-v1.0/weights.feather \
  "https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/connectome-weights-male-cns-v1.0-minconf-0.5.feather"
curl -fL --retry 4 -C - -o data/male-cns-v1.0/annotations.feather \
  "https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/body-annotations-male-cns-v1.0-minconf-0.5.feather"

python connectomes/import_graph.py \
  --edges data/male-cns-v1.0/weights.feather \
  --nodes data/male-cns-v1.0/annotations.feather \
  --pre body_pre --post body_post --weight weight \
  --node-column bodyId \
  --dataset male-cns-v1.0-2026 --version v1.0 \
  --source https://male-cns.janelia.org/download/ \
  --license CC-BY-4.0 \
  --out data/compiled/male-cns-v1.0

cargo test --manifest-path rust/connectome_engine/Cargo.toml
cargo run --release --manifest-path rust/connectome_engine/Cargo.toml -- \
  inspect data/compiled/male-cns-v1.0
cargo run --release --manifest-path rust/connectome_engine/Cargo.toml -- \
  neighbors data/compiled/male-cns-v1.0 12781 20
~~~

O grafo é um CSR direcionado, com os arquivos nodes.u64, offsets.u64, targets.u32, weights.f32 e manifest.json. O leitor Rust usa mapeamento read-only do disco. Um dataset de ~152 milhões de arestas exige mais de 1,2 GB só para adjacência convertida, além do download original.

**Importante:** a tabela completa da Janelia contém conexões segmento→segmento, inclusive IDs de segmentos que podem não estar classificados como neurônios. O importador preserva todos os registros e não chama indiscriminadamente esses segmentos de neurônios.

## BANC 2026

A versão publicada BANC v888 está no [Harvard Dataverse](https://doi.org/10.7910/DVN/7WTH1N) e no [Codex](https://codex.flywire.ai/?dataset=banc). Verifique a versão da tabela de sinapses (v2 ou v3) e os filtros de publicação antes da análise; alguns downloads exigem cadastro ou token.

Exemplo **apenas depois de verificar as colunas da tabela real**:

~~~sh
python connectomes/import_graph.py \
  --edges /caminho/para/edgelist_oficial.feather \
  --pre pre --post post --weight count \
  --dataset banc-female-2026-v888 --version v888 \
  --source https://doi.org/10.7910/DVN/7WTH1N \
  --license CC-BY-4.0 \
  --out data/compiled/banc-v888
~~~

O nome do arquivo e as colunas pre/post/count no exemplo são ilustrativos; consulte o esquema do arquivo oficial escolhido. Não se afirma que esse arquivo local existe.

## Limites científicos e técnicos

**Implementado:** catálogo versionado, importação em duas passagens e memória limitada de CSV/Feather/Parquet, identificadores originais, grafo CSR com validação, consultas de vizinhança e propagação matemática exploratória com limites explícitos de processamento.

**Não implementado:** baixar ou embutir todos os arquivos originais no GitHub, atribuir neurotransmissores e propriedades elétricas a cada neurônio, reprodução fisiológica realista, aprendizagem completa, controle do corpo por músculos e neurônios motores, servidor de simulação ou substituição direta do cérebro do pet online.

O comando de propagação usa conexões como pesos positivos não assinados, sem a fisiologia inibitória/excitatória real. **Não é uma demonstração de consciência nem uma mosca biológica simulada.**

Os dados brutos não são commitados. O motor neural original do DevilPet e os salvamentos dos pets continuam intactos.

## Referências e licença

Bates et al. (Nature, 2026), Berg et al. (Cell, 2026), FlyWire Consortium (Nature, 2024). Os dados publicados são propriedade intelectual e científica dos respectivos autores e possuem as condições de licença registradas no catálogo. Cite a publicação e a versão efetivamente usada.
