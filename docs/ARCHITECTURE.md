# DevilPet — arquitetura ativa em Python

O controle do corpo virtual e do mundo 3D permanece separado da
reconstrução anatômica. Não se deve afirmar que a conectividade sozinha
reproduz a fisiologia de todos os neurônios.

## Componentes

| Camada | Implementação | Função |
|---|---|---|
| Mundo 3D | environment/world3d.js e habitat3d.js | Three.js e objetos |
| Percepção | fly/sensors.js | Odores, visão, obstáculos, propriocepção |
| Agente | fly/agent.js | Interface local sensor → decisão, sem renderer |
| Cérebro local | neural-engine.js | Modelo reduzido de aprendizagem, JavaScript offline |
| Ponte | fly/connectome-bridge.js | HTTP com servidor Python, ativação voluntária |
| CNS completo | python/connectome_engine.py | Grafo dirigido CSR original mapeado por NumPy |
| Serviço | python/connectome_server.py | GET /health, POST /step, localhost, CORS |
| Pesquisa | python/connectome_cli.py | Inspeção de IDs, vizinhança e pulso |
| Importador | connectomes/import_graph.py | CSV/Feather/Parquet → CSR integral |
| Publicação | .github/workflows/python-pages.yml | HTML/JS/Three.js sem compilação Rust |
| Testes | python/tests + fly/python-browser-smoke.mjs | Proveniência, neuronal/HTTP e browser |

## Integridade

O neural-engine.js original e o formato de backup do pet não foram
modificados. Checkpoints antigos que contêm rustState também continuam
legíveis por suas chaves shortW e longW. Nenhum arquivo de pesos é apagado.

Rust não é mais carregado no navegador, utilizado pelo pipeline ativo,
nem necessário para consultar o CNS: os arquivos rust/ permanecem apenas
como histórico de implementação.

## Dados de 2026 e limites

Os conectomas de macho (Male CNS) e fêmea (BANC) são indivíduos separados,
cada um com sua versão e IDs originais. Não combinar sinapses.

O Python verifica o dataset e as portas revisadas antes de aceitar sensores
e emitir comandos motores. O método atual é uma **propagação matemática
sem sinais de neurotransmissão**, não um simulador neurofisiológico completo.
Conectoma anatômico integral não significa que a mosca já tenha um
comportamento funcional equivalente ao biológico.

O GitHub Pages não executa Python. O CNS real precisa rodar em computador
ou servidor com dados científicos e acesso autenticado via HTTPS em uso remoto.
