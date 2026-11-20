# Mosca e ambiente separados: CNS Python

A mosca e seus sensores não dependem do Three.js. A cena fica em
environment/world3d.js e environment/habitat3d.js, o estado do mundo fica em
environment/world-state.js, os órgãos sensoriais em fly/sensors.js e o
agente local em fly/agent.js.

O cenário continua sendo JavaScript para abrir offline no GitHub Pages.
O conectoma completo passa a usar Python + NumPy e não há ativação Rust/WASM.

## Caminho de sinais

Mundo físico → sensores virtuais → fly/connectome-bridge.js →
servidor Python no computador → grafo CSR com neurônios da mesma preparação
→ comando motor experimental → corpo virtual.

No navegador: Arquiteturas neurais → Conectoma real: serviço Python.

## Requisitos para ativar o CNS

1. Obter e compilar as conexões oficiais do BANC v888 ou Male CNS v1.0,
   sem concatenar indivíduos.
2. Identificar e revisar **IDs neuronais sensoriais/motores reais** da
   mesma versão usando a anotação científica, com evidências.
3. Copiar e preencher connectomes/ports.template.json. Deixar o template
   vazio faz o serviço recusar iniciar, como deve.
4. Instalar requisitos de python/requirements.txt e rodar:
   
       python python/connectome_server.py --graph data/compiled/male-cns-v1.0 --ports data/ports-reviewed.json --port 8326

5. No PC, informar o endereço local 127.0.0.1:8326 na interface;
   no celular, 127.0.0.1 aponta para o celular. Para uso remoto,
   é necessário proxy HTTPS autenticado. O GitHub Pages não hospeda Python.

O cérebro reduzido preservado é neural-engine.js, com os pesos de LTM e o backup do pet. O CNS externo não
é automaticamente salvo no mesmo backup.

A propagação atualmente implementada em Python não assina sinapses como
inibitórias/excitatórias nem modela toda a eletrofisiologia ou o aprendizado
biológico. Não afirmar "cérebro completo funcional" antes de validação.
