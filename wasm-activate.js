/**
 * DevilPet neural runtime: reliable, opt-in Rust engine for the browser.
 *
 * Architecture: UI/physics (index.html) -> runtime port -> Rust WASM/JS neurons.
 * No controller edits to neural-engine.js; all state migrations are transactional.
 * In case of any activation or runtime failure, the stable JS pet continues.
 */
const host = window.DevilPetRuntime;
const status = document.getElementById('brain-runtime');
const toggle = document.getElementById('brain-runtime-toggle');
const bootVersion = 'arch2';
let RustSparse = null;
let RustOdor = null;
let wasmReady = false;
let mode = 'javascript';
let fault = null;
let fallbackBrain = null;
let fallbackOdor = null;

function report(message) {
  if (status) status.textContent = message;
  if (toggle) {
    toggle.disabled = !wasmReady;
    toggle.textContent = !wasmReady ? 'Rust ainda indisponível' :
      mode === 'rust' ? 'Voltar ao JavaScript' : 'Ativar motor Rust';
    toggle.setAttribute('aria-pressed', String(mode === 'rust'));
  }
}
function isClose(a,b,tolerance=3e-9) {
  return Number.isFinite(a) && Number.isFinite(b) &&
    Math.abs(a-b) <= tolerance * Math.max(1,Math.abs(a),Math.abs(b));
}
function ensure(cond,message) {
  if (!cond) throw new Error(message);
}
function currentTier() { return host.getBrain().tierKey; }
report('Motor: JavaScript (inicialização segura)');

class WeightPort {
  constructor(read, write, length) {
    this.read=read;
    this.write=write;
    this.length=length;
  }
  *[Symbol.iterator]() { yield* this.read(); }
  set(source,offset=0) {
    const target=this.read();
    const values=Array.from(source);
    ensure(Number.isInteger(offset)&&offset>=0&&offset+values.length<=target.length,
      'Intervalo de pesos inválido');
    ensure(values.every(Number.isFinite),'Pesos sinápticos não finitos');
    target.set(values,offset);
    this.write(Array.from(target));
  }
  fill(value) {
    ensure(Number.isFinite(value),'Valor sináptico inválido');
    const target=this.read();
    target.fill(value);
    this.write(Array.from(target));
    return this;
  }
}

class RustSparseAdapter {
  constructor(tierKey,seed=42) {
    ensure(RustSparse,'Rust não inicializado');
    this.isRust=true;
    this.tierKey=tierKey;
    this.cfg=host.tiers[tierKey];
    ensure(this.cfg,'Arquitetura desconhecida');
    this.nKC=this.cfg.nKC;
    this.nPlastic=this.nKC*2;
    this.nTotal=30+this.nKC+this.cfg.nMBON+12;
    this.dt=.25;
    this.inner=new RustSparse(tierKey,seed);
    this.mbonRate=Float64Array.from(this.inner.mbon_rates());
    const weight=name=>new WeightPort(
      ()=>Float64Array.from(name==='shortW'?
        this.inner.get_short_weights():this.inner.get_long_weights()),
      values=>{
        const snapshot=this.fullSnapshot();
        snapshot[name]=values;
        this.restoreFull(snapshot);
      },
      this.nPlastic
    );
    this.shortW=weight('shortW');
    this.longW=weight('longW');
    this.elig={fill:value=>{
      ensure(value===0,'Apenas limpeza da elegibilidade disponível');
      this.inner.reset_weights();
    }};
    this.rng={
      next:()=>this.inner.next_rng(),
      getState:()=>this.inner.get_rng_state(),
      setState:value=>this.inner.set_rng_state(value>>>0)
    };
  }
  get tick() { return this.inner.get_tick(); }
  set tick(value) { this.inner.set_tick(value); }
  stepWindow(cue,modulation,consolidate,learn,duration=15) {
    const out=this.inner.step(cue.cyan,cue.amber,cue.red,cue.ball,cue.sky,
      modulation,consolidate,learn,duration);
    this.mbonRate=Float64Array.from(this.inner.mbon_rates());
    return out;
  }
  telemetry() { return this.inner.telemetry(); }
  fullSnapshot() { return JSON.parse(this.inner.full_snapshot_json()); }
  restoreFull(snapshot) {
    this.inner.restore_full_json(JSON.stringify(snapshot));
    this.mbonRate=Float64Array.from(this.inner.mbon_rates());
  }
  importLiveJs(jsBrain) {
    ensure(!jsBrain.isRust,'Esperado cérebro JavaScript');
    this.restoreFull({
      tierKey:jsBrain.tierKey,
      tick:jsBrain.tick,
      rng:jsBrain.rng.getState(),
      shortW:Array.from(jsBrain.shortW),
      longW:Array.from(jsBrain.longW),
      kc_connections:jsBrain.kcPre.map(row=>Array.from(row)),
      eligibility:Array.from(jsBrain.elig),
      kc_voltage:Array.from(jsBrain.kcV),
      mbon_rate:Array.from(jsBrain.mbonRate),
      working_mem:Array.from(jsBrain.workingMem),
      last_active_kc:jsBrain.lastActiveKC
    });
    const snapshot=this.fullSnapshot();
    ensure(snapshot.tick===jsBrain.tick &&
       snapshot.rng===jsBrain.rng.getState() &&
       snapshot.shortW.length===jsBrain.shortW.length &&
       isClose(snapshot.shortW.reduce((a,b)=>a+Math.abs(b),0),
          Array.from(jsBrain.shortW).reduce((a,b)=>a+Math.abs(b),0)),
       'Importação da mente inconsistente');
  }
  dispose() { this.inner?.free?.(); }
}
class RustOdorAdapter {
  constructor(seed=47) {
    ensure(RustOdor,'Rust olfativo não inicializado');
    this.isRust=true;
    this.inner=new RustOdor(seed);
    this.visits=Uint32Array.from(this.inner.get_visits());
  }
  choose(sensory,pet) {
    ensure(Array.isArray(sensory)&&sensory.length===4,'Esperados quatro sinais olfativos');
    return this.inner.choose(...sensory.map(s=>s.food),
      pet.energy,pet.rest,pet.curiosity);
  }
  odorValue(index) { return this.inner.odor_value(index); }
  reinforce(index,reward) { this.inner.reinforce(index,reward); }
  rest() { this.inner.rest(); }
  snapshot() {
    this.inner.set_visits(Array.from(this.visits));
    return JSON.parse(this.inner.snapshot_json());
  }
  restore(data) {
    if(!data)return;
    this.inner.restore_json(JSON.stringify(data));
    this.visits=Uint32Array.from(this.inner.get_visits());
  }
  get steps() { return this.inner.get_steps(); }
  get rewards() { return this.inner.get_rewards(); }
  get punishments() { return this.inner.get_punishments(); }
  get heading() { return this.inner.get_heading(); }
  set heading(value) { this.inner.set_heading(value); }
  get activity() { return this.inner.get_activity(); }
  set activity(value) { this.inner.set_activity(value); }
  get lastChoice() { return this.inner.get_last_choice(); }
  set lastChoice(value) { this.inner.set_last_choice(value); }
  dispose() { this.inner?.free?.(); }
}
function toJsSparse(source) {
  if(!source.isRust)return source;
  const state=source.fullSnapshot();
  const result=new host.JsSparse(source.tierKey,42);
  result.tick=state.tick;
  result.rng.setState(state.rng);
  result.shortW.set(state.shortW);
  result.longW.set(state.longW);
  result.elig.set(state.eligibility);
  result.kcV.set(state.kc_voltage);
  result.mbonRate.set(state.mbon_rate);
  result.workingMem.set(state.working_mem);
  result.kcPre=state.kc_connections.map(row=>Array.from(row));
  result.lastActiveKC=state.last_active_kc;
  return result;
}
function toJsOdor(source) {
  if(!source.isRust)return source;
  const result=new host.JsOdor(47);
  result.restore(source.snapshot());
  result.heading=source.heading;
  result.activity=source.activity;
  result.lastChoice=source.lastChoice;
  return result;
}
function toRustOdor(source) {
  const result=new RustOdorAdapter(47);
  result.restore(source.snapshot());
  result.heading=source.heading;
  result.activity=source.activity;
  result.lastChoice=source.lastChoice;
  return result;
}
function selfTest() {
  const original=new host.JsSparse('drosophila',42);
  const rust=new RustSparseAdapter('drosophila',42);
  const olfJs=new host.JsOdor(47);
  const olfRust=new RustOdorAdapter(47);
  try {
    const cues={cyan:.75,amber:.05,red:.1,ball:.4,sky:.5};
    for(const modulation of [1,0,-1]){
      const reference=original.stepWindow(cues,modulation,.25,true,15);
      const actual=rust.stepWindow(cues,modulation,.25,true,15);
      ensure(isClose(reference.sparsityPct,actual.sparsityPct)&&
        reference.dnSpikes===actual.dnSpikes,'O circuito esparso divergiu');
      ensure(original.rng.getState()===rust.rng.getState(),'RNG divergente');
    }
    for(let i=0;i<original.shortW.length;i++){
      ensure(isClose(original.shortW[i],Array.from(rust.shortW)[i]),'Pesos divergentes');
    }
    // Motion/path integration also uses the neural model's RNG stream.
    ensure(isClose(original.rng.next(),rust.rng.next()),'RNG de movimento divergente');
    ensure(original.rng.getState()===rust.rng.getState(),'Estado RNG após movimento divergente');
    const signals=Array.from({length:4},()=>({food:.5}));
    const vitals={energy:.7,rest:.6,curiosity:.8};
    const j=olfJs.choose(signals,vitals);
    const w=olfRust.choose(signals,vitals);
    ensure(j.activity===w.activity&&j.target===w.target,'Decisão olfativa divergente');
    olfJs.reinforce(0,1);olfRust.reinforce(0,1);
    ensure(isClose(olfJs.odorValue(0),olfRust.odorValue(0)),'Reforço olfativo divergente');
    // Validate an actual neural state exchange before enabling controls.
    const copy=new RustSparseAdapter('drosophila',42);
    try {
      copy.importLiveJs(original);
      ensure(isClose(copy.telemetry().meanShort,original.telemetry().meanShort),
         'Transferência de memória divergente');
    } finally { copy.dispose(); }
    const replay=new host.JsSparse('drosophila',42);
    const snapshot=rust.fullSnapshot();
    const restored=new RustSparseAdapter('drosophila',42);
    try {
      restored.restoreFull(snapshot);
      ensure(restored.rng.getState()===rust.rng.getState(),'Restauração divergente');
      // No mutation to the actual pet: the test uses disposable engines.
      void replay;
    }finally { restored.dispose(); }
  } finally { rust.dispose(); olfRust.dispose(); }
}
function activate() {
  ensure(wasmReady,'Motor Rust indisponível');
  if(mode==='rust')return true;
  const beforeBrain=host.getBrain();
  const beforeOdor=host.getOdor();
  let nextBrain=null,nextOdor=null;
  try {
    const jsBrain=toJsSparse(beforeBrain);
    const jsOdor=toJsOdor(beforeOdor);
    nextBrain=new RustSparseAdapter(jsBrain.tierKey,42);
    nextBrain.importLiveJs(jsBrain);
    nextOdor=toRustOdor(jsOdor);
    // Commit atomically only after both models are ready.
    host.setBrain(nextBrain);
    host.setOdor(nextOdor);
    fallbackBrain=jsBrain;
    fallbackOdor=jsOdor;
    mode='rust';
    report('Motor: Rust / WebAssembly (ativo)');
    return true;
  }catch(error){
    host.setBrain(beforeBrain);
    host.setOdor(beforeOdor);
    nextBrain?.dispose();
    nextOdor?.dispose();
    throw error;
  }
}
function deactivate() {
  const beforeBrain=host.getBrain();
  const beforeOdor=host.getOdor();
  let newBrain,newOdor;
  try {
    newBrain=toJsSparse(beforeBrain);
    newOdor=toJsOdor(beforeOdor);
  }catch(error){
    // Last consistent JS state captured at activation is preferable to an unusable game.
    if(!fallbackBrain||!fallbackOdor)throw error;
    console.warn('Não foi possível converter o estado atual; restaurando checkpoint de segurança',error);
    newBrain=fallbackBrain;
    newOdor=fallbackOdor;
  }
  host.setBrain(newBrain);
  host.setOdor(newOdor);
  mode='javascript';
  beforeBrain.isRust&&beforeBrain.dispose?.();
  beforeOdor.isRust&&beforeOdor.dispose?.();
  report('Motor: JavaScript (estável)');
  return true;
}
function recover(error) {
  if(!(host.getBrain()?.isRust||host.getOdor()?.isRust))return false;
  console.error('Motor Rust interrompido; revertendo ao JavaScript',error);
  try {
    deactivate();
    fault=error?.message||String(error);
    report('Motor: JavaScript (recuperado de falha Rust)');
    return true;
  }catch(secondError){
    console.error('Recuperação do motor neural falhou',secondError);
    return false;
  }
}
window.DevilPetRustRecover=recover;
window.DevilPetRustStatus=()=>({mode,ready:wasmReady,error:fault});
window.DevilPetRustActivate=activate;
window.DevilPetRustDeactivate=deactivate;
toggle?.addEventListener('click',()=>{
  try {
    if(mode==='rust')deactivate();
    else activate();
  }catch(error){
    fault=error.message||String(error);
    console.error('Troca de motor neural cancelada',error);
    report('Motor: JavaScript (falha ao ativar Rust)');
  }
});
window.DevilPetRustBoot=(async()=>{
  try {
    const pkg=await import('./rust/devilpet_brain/pkg/devilpet_brain.js?v='+bootVersion);
    await pkg.default();
    RustSparse=pkg.WasmSparseBrain;
    RustOdor=pkg.WasmOdorBrain;
    ensure(RustSparse&&RustOdor,'Arquivo WASM incompleto');
    selfTest();
    wasmReady=true;
    host.installFactory({
      brain:(tier,seed)=>mode==='rust'?new RustSparseAdapter(tier,seed):new host.JsSparse(tier,seed),
      odor:seed=>mode==='rust'?new RustOdorAdapter(seed):new host.JsOdor(seed)
    });
    report('Motor: JavaScript (Rust validado e pronto para ativar)');
    return true;
  }catch(error){
    fault=error?.message||String(error);
    wasmReady=false;
    console.warn('Rust WebAssembly indisponível, JavaScript preservado:',error);
    report('Motor: JavaScript (Rust indisponível neste navegador)');
    return false;
  }
})();
