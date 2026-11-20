/* Experimental embodied controller: perception -> motivation -> associative memory -> motor.
 * Independent of DOM/Three.js. All quantities are virtual, not calibrated biology.
 * This module is opt-in and does not modify the stable pet or its saved weights.
 */
(function(root){
'use strict';
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,Number.isFinite(x)?x:0));
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
class FlyBehavior {
 constructor({seed=17,learningRate=.24}={}){
  this.seed=(seed>>>0)||0x9e3779b9;this.learningRate=learningRate;
  this.values=new Map();this.eligibility=new Map();
  this.state={energy:1,rest:1,threat:0,curiosity:.6};
  this.mode='explore';this.lastCue=null;this.lastMotor=null;this.steps=0;
 }
 random(){let x=this.seed;x^=x<<13;x^=x>>>17;x^=x<<5;this.seed=x>>>0;return this.seed/4294967296;}
 // Uses sensory observation ONLY. No access to target coordinates or world.
 step(frame,{dt=.1,reward=0}={}){
  if(!frame?.proprioception||!frame?.mechanosense||!frame?.vision||!Array.isArray(frame.odors))throw new TypeError('invalid sensory frame');
  if(!Number.isFinite(dt)||dt<=0||dt>1)throw new RangeError('dt');
  const p=frame.proprioception,m=frame.mechanosense;
  this.state.energy=clamp(p.energy);this.state.rest=clamp(p.rest);
  this.state.curiosity=clamp(p.curiosity);this.state.threat=clamp(Math.max(m.front||0,m.contact?1:0));
  // Eligibility is credited to PREVIOUS observed stimulus, never future stimulus.
  if(this.lastCue!==null&&Number.isFinite(reward)&&reward!==0)this.reinforce(this.lastCue,reward);
  const odorL=frame.odors.reduce((s,o)=>s+clamp(o.left),0);
  const odorR=frame.odors.reduce((s,o)=>s+clamp(o.right),0);
  const odor=clamp((odorL+odorR)/2);
  const dominant=frame.odors.reduce((best,o)=>{const strength=clamp(o.left)+clamp(o.right);return strength>best.strength?{identity:String(o.identity||'fruit').slice(0,64),strength}:best;},{identity:'fruit',strength:0});
  const cue=odor>.015?'odor:'+dominant.identity:clamp(frame.vision.contrast)>.2?'visual':'neutral';
  const value=this.values.get(cue)||0;
  const hunger=1-this.state.energy,fatigue=1-this.state.rest;
  const danger=this.state.threat;
  const scores={
   avoid:danger*2.4+Math.max(0,-value)*odor,
   feed:hunger*1.6+Math.max(0,value)*odor+(frame.taste?.food?1:0),
   rest:fatigue*1.9,
   explore:.25+this.state.curiosity*.7
  };
  this.mode=Object.keys(scores).reduce((a,b)=>scores[b]>scores[a]?b:a,'explore');
  // Left/right differential gives steering without privileged positions.
  const gradient=clamp((odorL-odorR)/(odorL+odorR+.02),-1,1);
  const visual=clamp((clamp(frame.vision.left)-clamp(frame.vision.right)),-1,1);
  const avoidance=clamp((clamp(m.right)-clamp(m.left)), -1,1);
  const obstacle=clamp(m.front);
  const seek=this.mode==='feed'?(value<0?-1:1):this.mode==='avoid'?-1:0;
  const turn=clamp(seek*(gradient*.75+visual*.2)+avoidance*.8+(obstacle>.65?.65:0)+(this.random()-.5)*.15,-1,1);
  const forward=this.mode==='rest'?0:clamp((this.mode==='avoid'?.8:.45)+hunger*.15-obstacle*.65);
  const lift=this.mode==='avoid'?clamp(.3+danger*.6):this.mode==='rest'?0:clamp((frame.airflow?.forward||0)*-.2);
  this.lastCue=cue;this.steps++;
  this.lastMotor={forward,turn,lift,activity:forward+Math.abs(turn)+lift,mode:this.mode};
  return {...this.lastMotor,perception:{odorLeft:odorL,odorRight:odorR,obstacle,visual,threat:danger},motivation:{...scores},memoryValue:value};
 }
 reinforce(cue,reward){
  if(typeof cue!=='string'||!Number.isFinite(reward))throw new TypeError('invalid reinforcement');
  const old=this.values.get(cue)||0;
  this.values.set(cue,clamp(old+this.learningRate*clamp(reward,-1,1)*(1-Math.abs(old)),-1,1));
 }
 sleep({durationSeconds=60}={}){
  if(!Number.isFinite(durationSeconds)||durationSeconds<0||durationSeconds>86400)throw new RangeError('durationSeconds');
  // Simplified retention; no unsupported claim of sleep-dependent biological consolidation.
  const retention=Math.exp(-durationSeconds/6048000);
  for(const [k,v] of this.values)this.values.set(k,v*retention);
 }
 snapshot(){return {version:1,seed:this.seed,steps:this.steps,values:Object.fromEntries(this.values),state:{...this.state}};}
 restore(s){
  if(s?.version!==1||!Number.isInteger(s.seed)||!Number.isInteger(s.steps)||s.steps<0||!s.values||typeof s.values!=='object')throw new TypeError('invalid snapshot');
  const vals=Object.entries(s.values);
  if(vals.length>100||vals.some(([k,v])=>k.length>64||!Number.isFinite(v)||Math.abs(v)>1))throw new TypeError('invalid memory');
  this.seed=(s.seed>>>0)||0x9e3779b9;this.steps=s.steps;this.values=new Map(vals);this.lastCue=null;
  if(s.state&&typeof s.state==='object')for(const k of ['energy','rest','threat','curiosity'])if(Number.isFinite(s.state[k]))this.state[k]=clamp(s.state[k]);
 }
}
const api=Object.freeze({FlyBehavior});
if(typeof module==='object'&&module.exports)module.exports=api;
if(root)root.DevilPetBehavior=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:this);
