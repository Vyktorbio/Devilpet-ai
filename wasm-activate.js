/* DevilPet: dynamic Rust WebAssembly runtime.
 * Keeps original JS engine, checks full-state compatibility and falls back safely.
 * This module does not alter neural or plasticity rules.
 */
const host = window.DevilPetRuntime;
const status = document.getElementById('brain-runtime');
const toggle = document.getElementById('brain-runtime-toggle');
let WasmSparseBrain = null, WasmOdorBrain = null;
let mode = 'javascript';

function show(text) {
  if(status) status.textContent = text;
  if(toggle) {
    toggle.disabled = !WasmSparseBrain || !WasmOdorBrain;
    toggle.textContent = !WasmSparseBrain ? 'Rust indisponível' :
      mode === 'rust' ? 'Usar JavaScript' : 'Usar Rust';
  }
}
show('Motor: JavaScript (carregando Rust…)');

class WeightView {
  constructor(read, write, length) {
    this._read = read; this._write = write; this.length = length;
  }
  *[Symbol.iterator]() { yield* this._read(); }
  set(values, offset = 0) {
    const arr = this._read();
    const vals = Array.from(values);
    if(offset < 0 || offset + vals.length > arr.length) throw new RangeError('pesos fora do limite');
    arr.set(vals, offset);
    this._write(Array.from(arr));
  }
  fill(v) { const arr = this._read(); arr.fill(v); this._write(Array.from(arr)); return this; }
}

class RustSparseAdapter {
  constructor(tierKey, seed = 42) {
    this.isRust = true;
    this.tierKey = tierKey;
    this.cfg = host.tiers[tierKey];
    if(!this.cfg) throw new Error('Arquitetura desconhecida: ' + tierKey);
    this.nKC = this.cfg.nKC;
    this.nPlastic = 2*this.nKC;
    this.nTotal = 30 + this.nKC + this.cfg.nMBON + 12;
    this.dt = 0.25;
    this.inner = new WasmSparseBrain(tierKey,seed);
    this.mbonRate = Float64Array.from(this.inner.mbon_rates());
    const part = name => new WeightView(
      () => Float64Array.from(name === 'shortW' ? this.inner.get_short_weights() : this.inner.get_long_weights()),
      arr => {
        const full = JSON.parse(this.inner.full_snapshot_json());
        full[name] = arr;
        this.inner.restore_full_json(JSON.stringify(full));
      },
      this.nPlastic
    );
    this.shortW = part('shortW');
    this.longW = part('longW');
    // Only used by the pre-existing reset handler, never during learning.
    this.elig = { fill: v => {
      if(v !== 0) throw new Error('Elegibilidade só admite limpeza');
      this.inner.reset_weights();
    }};
    this.rng = {
      getState: () => this.inner.get_rng_state(),
      setState: v => this.inner.set_rng_state(v >>> 0)
    };
  }
  get tick() { return this.inner.get_tick(); }
  set tick(v) { this.inner.set_tick(v); }
  stepWindow(cues, modulation, consolidate, learn, durationMs = 15.0) {
    const out = this.inner.step(cues.cyan,cues.amber,cues.red,cues.ball,cues.sky,
      modulation,consolidate,learn,durationMs);
    this.mbonRate = Float64Array.from(this.inner.mbon_rates());
    return out;
  }
  telemetry() { return this.inner.telemetry(); }
  fullSnapshot() { return JSON.parse(this.inner.full_snapshot_json()); }
  restoreFull(s) {
    this.inner.restore_full_json(JSON.stringify(s));
    this.mbonRate = Float64Array.from(this.inner.mbon_rates());
  }
  restoreFromLiveJs(js) {
    this.restoreFull({
      tierKey: js.tierKey,
      tick: js.tick,
      rng: js.rng.getState(),
      shortW: Array.from(js.shortW),
      longW: Array.from(js.longW),
      kc_connections: js.kcPre.map(row=>Array.from(row)),
      eligibility: Array.from(js.elig),
      kc_voltage: Array.from(js.kcV),
      mbon_rate: Array.from(js.mbonRate),
      working_mem: Array.from(js.workingMem),
      last_active_kc: js.lastActiveKC
    });
  }
}

class RustOdorAdapter {
  constructor(seed = 47) {
    this.isRust = true;
    this.inner = new WasmOdorBrain(seed);
    this.visits = Uint32Array.from(this.inner.get_visits());
  }
  choose(sensory,pet) {
    if(!Array.isArray(sensory) || sensory.length !== 4) throw new Error('4 odores necessários');
    return this.inner.choose(...sensory.map(s=>s.food),pet.energy,pet.rest,pet.curiosity);
  }
  odorValue(i) { return this.inner.odor_value(i); }
  reinforce(i, val) { this.inner.reinforce(i,val); }
  rest() { this.inner.rest(); }
  snapshot() {
    this.inner.set_visits(Array.from(this.visits));
    return JSON.parse(this.inner.snapshot_json());
  }
  restore(s) {
    if(!s) return;
    this.inner.restore_json(JSON.stringify(s));
    this.visits = Uint32Array.from(this.inner.get_visits());
  }
  get steps() { return this.inner.get_steps(); }
  get rewards() { return this.inner.get_rewards(); }
  get punishments() { return this.inner.get_punishments(); }
  get heading() { return this.inner.get_heading(); }
  set heading(v) { this.inner.set_heading(v); }
  get activity() { return this.inner.get_activity(); }
  set activity(v) { this.inner.set_activity(v); }
  get lastChoice() { return this.inner.get_last_choice(); }
  set lastChoice(v) { this.inner.set_last_choice(v); }
}

function jsBrainFromRust(current) {
  const b = new host.JsSparse(current.tierKey,42);
  const snap = current.fullSnapshot();
  b.tick=snap.tick;
  b.rng.setState(snap.rng);
  b.shortW.set(snap.shortW);
  b.longW.set(snap.longW);
  b.elig.set(snap.eligibility);
  b.kcV.set(snap.kc_voltage);
  b.mbonRate.set(snap.mbon_rate);
  b.workingMem.set(snap.working_mem);
  b.kcPre = snap.kc_connections.map(row=>Array.from(row));
  b.lastActiveKC = snap.last_active_kc;
  return b;
}
function jsOdorFromRust(current) {
  const m = new host.JsOdor(47);
  m.restore(current.snapshot());
  m.heading=current.heading;
  m.activity=current.activity;
  m.lastChoice=current.lastChoice;
  return m;
}
function rustOdorFromJs(current) {
  const m = new RustOdorAdapter(47);
  m.restore(current.snapshot());
  m.heading = current.heading;
  m.activity = current.activity;
  m.lastChoice = current.lastChoice;
  return m;
}
function switchToRust() {
  if(!WasmSparseBrain || !WasmOdorBrain) return;
  const current=host.getBrain(), odor=host.getOdor();
  if(current.isRust && odor.isRust){mode='rust';show('Motor: Rust / WebAssembly (2 circuitos)');return;}
  const upgraded=new RustSparseAdapter(current.tierKey,42);
  // Preserve a full Rust state if the game has not taken a step since restoring.
  let exact = false;
  try {
    const saved=JSON.parse(localStorage.getItem('drosophila_3d_trainer_v1')||'null');
    if(saved && saved.rustState && current.tick===saved.tick &&
       current.rng.getState()===saved.rng && saved.rustState.tierKey===current.tierKey){
      upgraded.restoreFull(saved.rustState);exact=true;
    }
  }catch(e){console.warn('Rust state not restorable, using live JS state',e);}
  if(!exact)upgraded.restoreFromLiveJs(current);
  const upgradedOdor=rustOdorFromJs(odor);
  host.setBrain(upgraded);
  host.setOdor(upgradedOdor);
  mode='rust';show('Motor: Rust / WebAssembly (2 circuitos)');
}
function switchToJs() {
  const current=host.getBrain(), odor=host.getOdor();
  if(current.isRust) host.setBrain(jsBrainFromRust(current));
  if(odor.isRust) host.setOdor(jsOdorFromRust(odor));
  mode='javascript';
  show('Motor: JavaScript (original)');
}
if(toggle){
  toggle.addEventListener('click',()=>{
    try {
      if(mode==='rust')switchToJs();
      else switchToRust();
    }catch(e){console.error('Falha ao trocar motor neural',e);show('Troca de motor falhou; ver console.');}
  });
}
window.DevilPetRustBoot = (async()=>{
  try {
    // Dynamically import: an absent WASM asset must never break the JS pet.
    const pkg = await import('./rust/devilpet_brain/pkg/devilpet_brain.js?v=wasm1');
    await pkg.default();
    WasmSparseBrain=pkg.WasmSparseBrain;
    WasmOdorBrain=pkg.WasmOdorBrain;
    if(!WasmSparseBrain || !WasmOdorBrain) throw new Error('Bindings incompletos');
    host.installFactory({
      brain:(tier,seed)=>mode==='rust'?new RustSparseAdapter(tier,seed):new host.JsSparse(tier,seed),
      odor:(seed)=>mode==='rust'?new RustOdorAdapter(seed):new host.JsOdor(seed)
    });
    switchToRust();
  }catch(error){
    console.warn('DevilPet: Rust WASM indisponível. Mantendo cérebro JavaScript.',error);
    mode='javascript';
    show('Motor: JavaScript (Rust indisponível)');
  }
})();
