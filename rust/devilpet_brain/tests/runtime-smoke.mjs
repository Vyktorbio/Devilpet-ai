// Run against the actual wasm-pack distribution in CI after wasm-pack build.
// Tests the real browser adapter, neural-state migration, opt-in and fallback.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=resolve(process.cwd(),'../../..');
const neural=readFileSync(join(root,'neural-engine.js'),'utf8');
const {ArchitecturalFlyBrain,FlyNeuroEthology,TIERS}=
  new Function(neural+'\nreturn {ArchitecturalFlyBrain, FlyNeuroEthology,TIERS};')();

const ui={status:{textContent:''},
  toggle:{disabled:true,textContent:'',setAttribute(){},addEventListener(event,handler){this.handler=handler;}}};
globalThis.document={getElementById(id){
  return id==='brain-runtime'?ui.status:id==='brain-runtime-toggle'?ui.toggle:null;
}};
globalThis.window=globalThis;
globalThis.localStorage={getItem(){return null;}};

let brain=new ArchitecturalFlyBrain('drosophila',42);
let odor=new FlyNeuroEthology(47);
globalThis.DevilPetRuntime={
  getBrain:()=>brain,
  setBrain:b=>{brain=b;},
  getOdor:()=>odor,
  setOdor:o=>{odor=o;},
  tiers:TIERS,
  JsSparse:ArchitecturalFlyBrain,
  JsOdor:FlyNeuroEthology,
  installFactory:f=>{globalThis.DevilPetNeuralFactory=f;}
};
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(input,options)=>{
  const url=input instanceof URL ? input :
    typeof input==='string' ? new URL(input,'file:///') : input?.url&&new URL(input.url);
  if(url?.protocol==='file:'){
    return new Response(readFileSync(fileURLToPath(url)),{
      headers:{'Content-Type':'application/wasm'},status:200
    });
  }
  return nativeFetch(input,options);
};

const args={cyan:.75,amber:.05,red:.1,ball:.4,sky:.5};
brain.stepWindow(args,1,.02,true,15);
const before=brain.shortW[0],beforeTick=brain.tick,beforeRng=brain.rng.getState();
odor.reinforce(0,1);
const odorBefore=odor.odorValue(0);

await import(pathToFileURL(join(root,'wasm-activate.js')).href);
const ready=await globalThis.DevilPetRustBoot;
assert.equal(ready,true,'Rust bridge should pass equivalence self-test');
assert.equal(globalThis.DevilPetRustStatus().mode,'javascript','must not auto-activate');
assert.ok(!ui.toggle.disabled,'enable only after self-test');
assert.match(ui.status.textContent,/Rust validado/);
assert.equal(globalThis.DevilPetRustActivate(),true);
assert.equal(globalThis.DevilPetRustStatus().mode,'rust');
assert.equal(brain.isRust,true);
assert.equal(odor.isRust,true);
assert.equal(brain.tick,beforeTick);
assert.equal(brain.rng.getState(),beforeRng);
assert.ok(Math.abs(Array.from(brain.shortW)[0]-before)<1e-12);
assert.ok(brain.rng.next()>=0&&brain.rng.next()<1, 'scene movement needs RNG.next');
assert.ok(Math.abs(odor.odorValue(0)-odorBefore)<1e-12);
brain.stepWindow(args,0,.8,true,15);
const snapshot=brain.fullSnapshot();
assert.ok(snapshot.kc_connections.length===48);
assert.ok(brain.tick>beforeTick);
assert.equal(globalThis.DevilPetRustDeactivate(),true);
assert.equal(globalThis.DevilPetRustStatus().mode,'javascript');
assert.equal(brain.isRust,undefined);
assert.ok(Math.abs(brain.shortW[0]-snapshot.shortW[0])<1e-12);
assert.equal(brain.rng.getState(),snapshot.rng);
assert.equal(globalThis.DevilPetRustActivate(),true);
assert.equal(globalThis.DevilPetRustRecover(new Error('simulated failure')),true);
assert.equal(globalThis.DevilPetRustStatus().mode,'javascript');
assert.notEqual(brain.isRust,true);
brain.stepWindow(args,0,.02,true,15);
assert.ok(Number.isFinite(brain.telemetry().meanLong));
console.log('PASS: JS safe boot; WASM self-test; live state; Rust step; JS fallback; recovery.');
