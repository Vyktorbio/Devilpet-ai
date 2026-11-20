/* DevilPet embodied fly, independent from any rendering engine.
 * No THREE, DOM, camera, HTML, scene, object coordinates or environment logic.
 * Neural dynamics remain in neural-engine.js / Rust WASM.
 */
(function(root){
  'use strict';
  class FlyAgent {
    constructor({getBrain,getOdor,sensors}){
      if(typeof getBrain!=='function'||typeof getOdor!=='function'||!sensors?.sample)
        throw new TypeError('agent requires neural ports and a sensory organ');
      this.getBrain=getBrain;
      this.getOdor=getOdor;
      this.sensors=sensors;
      this.lastObservation=null;
      this.lastOutput=null;
    }
    perceive(world,pose,vitals,options){
      const frame=this.sensors.sample(world,pose,vitals,options);
      this.lastObservation=frame;
      return frame;
    }
    // Controller gets only sensor channels, not x/z targets, props or camera.
    react(frame,vitals,{modulation=0,consolidate=.02,sleeping=false,durationMs=15}={}){
      if(!frame||!frame.cues||!Array.isArray(frame.odors))
        throw new TypeError('invalid sensor observation');
      const brain=this.getBrain();
      const odor=this.getOdor();
      const out=brain.stepWindow(frame.cues,sleeping?0:modulation,
        consolidate,!sleeping,durationMs);
      const decision=odor.choose(frame.odors,vitals);
      this.lastOutput={out,decision};
      return this.lastOutput;
    }
    get status(){
      const brain=this.getBrain();
      return Object.freeze({
        model:brain?.isRust?'rust-reduced':'javascript-reduced',
        neuralTier:brain?.tierKey||'unknown',
        sensors:this.lastObservation?Object.keys(this.lastObservation).length:0
      });
    }
  }
  const api=Object.freeze({FlyAgent});
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.DevilPetFly=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:this);
