# DevilPet CNS — motor Python

O conectoma completo passa a usar Python + NumPy. Three.js e sensores ficam no
navegador, JavaScript. O cérebro reduzido JavaScript funciona offline e mantém
seus pesos e salvamentos. Rust/WebAssembly sai da execução e do deploy ativo;
os fontes legados Rust ficam arquivados no repositório para consulta.

## Arquitetura

Ambiente 3D → sensores → ponte HTTP → servidor Python → grafo CSR anatômico
mapeado em memória → propagação experimental → saída motora → corpo virtual.

O grafo real não pode ser baixado automaticamente no celular: um arquivo de
conexões tem mais de 1 GB. O GitHub Pages publica HTML/JS, não serviços Python.

## Instalar no computador

Use Python 3.10+ e execute da raiz do repositório:

    python -m pip install -r python/requirements.txt
    python -m pip install "pyarrow>=18,<26"

Para importar as tabelas oficiais do Male CNS v1.0 de 2026, use os links e
comandos de connectomes/README.md. O conversor continua sendo Python e o
formato CSR original permanece compatível, sem refazer as sinapses.

    python python/connectome_cli.py inspect data/compiled/male-cns-v1.0

O servidor **somente inicia** com o grafo original importado e um mapa de
identificadores e funções neuronais da mesma versão, revisado e com evidências.
Copie connectomes/ports.template.json para data/ports-reviewed.json e preencha
usando IDs reais das anotações oficiais. A triagem de candidatos em
connectomes/extract_ports.py não determina sozinha a lateralidade nem a
ação muscular.

    python python/connectome_server.py --graph data/compiled/male-cns-v1.0 --ports data/ports-reviewed.json --host 127.0.0.1 --port 8326

O serviço expõe GET /health e POST /step. O protocolo é compatível com a ponte
existente fly/connectome-bridge.js, com checagem explícita backend=python.
Em caso de falha ou desconexão, o pet retoma seu motor reduzido.

## Celular e acesso remoto

O endereço 127.0.0.1, aberto no celular, aponta para o **próprio celular**,
não para o computador onde o serviço Python está rodando.

Para utilizar remotamente, configure um túnel ou proxy HTTPS autenticado
adequadamente com CORS e controle de acesso. Não exponha a porta local
do servidor diretamente à internet. GitHub Pages sozinho não executa Python.

## Testes

    python -m unittest discover -s python/tests -v
    node fly/connectome-bridge.test.cjs
    node fly/sensors.test.cjs

Os testes usam grafos declaradamente **sintéticos**; verificam estrutura,
neurônios de IDs grandes, evidência do mapa neuronal, API e segurança.
O GitHub Actions testa a cena no Chromium sem compilar Rust.

## Limites científicos

Conectividade anatômica não define propriedades elétricas, plasticidade,
neurotransmissão ou movimentos da mosca. Este motor propaga sinais
matematicamente sobre sinapses reais, sem afirmar que seja uma simulação
fisiológica completa. Não mistura reconstruções de animais diferentes.
Sem o grafo científico e os mapeamentos neurais, o serviço recusa iniciar.
