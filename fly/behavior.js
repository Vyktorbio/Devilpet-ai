/* Sensorimotor plastic controller. No action labels, goals or target coordinates.
 * Virtual neural model, not a biological connectome reconstruction.
 */
(function(root){
'use strict';
const clip=(v,a=-1,b=1)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:0));
class FlyBehavior {
 constructor({seed=17,learningRate=.035}={}){
  this.seed=(seed>>>0)||17;this.learningRate=learningRate;
  this.inputs=20;this.hidden=32;this.outputs=3;this.steps=0;
  this.w1=new Float32Array(this.inputs*this.hidden);
  this.w2=new Float32Array(this.hidden*this.outputs);
  this.b1=new Float32Array(this.hidden);this.b2=new Float32Array(this.outputs);
  this.trace=new Float32Array(this.w2.length);
  this.activity=new Float32Array(this.hidden);
  this.prevReward=0;this.lastMotor=null;this.mode='neural';
  for(let i=0;i<this.w1.length;i++)this.w1[i]=(this.random()-.5)*.65;
  for(let i=0;i<this.w2.length;i++)this.w2[i]=(this.random()-.5)*.25;
  this.b2[0]=.45;
 }
 random(){let x=this.seed;x^=x<<13;x^=x>>>17;x^=x<<5;this.seed=x>>>0;return this.seed/4294967296;}
 step(frame,{dt=.016,reward=0}={}){
  if(!frame?.proprioception||!frame?.mechanosense||!frame?.vision||!Array.isArray(frame.odors))throw new TypeError('invalid sensory frame');
  if(!(dt>0&&dt<=1))throw new RangeError('dt');
  const p=frame.proprioception,m=frame.mechanosense,v=frame.vision;
  const odorL=frame.odors.reduce((s,o)=>s+clip(o.left,0,1),0);
  const odorR=frame.odors.reduce((s,o)=>s+clip(o.right,0,1),0);
  const x=[
   clip(odorL,0,1),clip(odorR,0,1),clip(v.left,0,1),clip(v.right,0,1),
   clip(m.left,0,1),clip(m.front,0,1),clip(m.right,0,1),m.contact?1:0,
   clip(frame.moisture||0,0,1),frame.taste?.water?1:0,frame.taste?.food?1:0,
   clip(p.energy,0,1),clip(p.rest,0,1),clip(p.hydration??1,0,1),
   clip(p.curiosity,0,1),clip(p.altitude,0,1),
   clip(frame.airflow?.forward||0),clip(frame.airflow?.lateral||0),
   clip(p.headingSin||0),clip(p.headingCos||0)
  ];
  // Delayed reward updates the previously active sensorimotor synapses.
  const r=clip(reward);
  const predictionError=r-this.prevReward;
  if(this.steps>0&&Number.isFinite(reward)){
   for(let i=0;i<this.w2.length;i++)this.w2[i]=clip(this.w2[i]+this.learningRate*predictionError*this.trace[i],-2,2);
  }
  this.prevReward=this.prevReward*.98+r*.02;
  for(let j=0;j<this.hidden;j++){
   let sum=this.b1[j];
   for(let i=0;i<this.inputs;i++)sum+=x[i]*this.w1[i*this.hidden+j];
   this.activity[j]=Math.tanh(sum);
  }
  const outputs=[];
  for(let k=0;k<this.outputs;k++){
   let sum=this.b2[k];
   for(let j=0;j<this.hidden;j++)sum+=this.activity[j]*this.w2[j*this.outputs+k];
   outputs.push(Math.tanh(sum));
  }
  // Exploratory noise supplies variation, but never selects a named behavior.
  const forward=clip((outputs[0]+1)/2+(this.random()-.5)*.12,0,1);
  const turn=clip(outputs[1]+(this.random()-.5)*.24);
  const lift=clip(outputs[2]+(this.random()-.5)*.1);
  const motor=[forward*2-1,turn,lift];
  for(let j=0;j<this.hidden;j++)for(let k=0;k<3;k++){
   const index=j*3+k;
   this.trace[index]=clip(this.trace[index]*.97+this.activity[j]*motor[k]*.03,-1,1);
  }
  this.steps++;
  this.lastMotor={forward,turn,lift,activity:forward+Math.abs(turn)+Math.abs(lift),mode:'neural'};
  return {...this.lastMotor,perception:{odorLeft:odorL,odorRight:odorR,obstacle:clip(m.front,0,1)},motivation:{},memoryValue:0};
 }
 sleep({durationSeconds=60}={}){if(!(durationSeconds>=0&&durationSeconds<=86400))throw new RangeError('durationSeconds');}
 snapshot(){return {version:2,seed:this.seed,steps:this.steps,w1:Array.from(this.w1),w2:Array.from(this.w2),b1:Array.from(this.b1),b2:Array.from(this.b2),trace:Array.from(this.trace),prevReward:this.prevReward};}
 restore(s){
  if(s?.version===1){this.seed=s.seed>>>0;this.steps=0;return;}
  if(s?.version!==2||!Number.isInteger(s.seed)||!Number.isInteger(s.steps)||s.steps<0)throw new TypeError('invalid snapshot');
  for(const [key,target] of [['w1',this.w1],['w2',this.w2],['b1',this.b1],['b2',this.b2],['trace',this.trace]]){
   if(!Array.isArray(s[key])||s[key].length!==target.length||!s[key].every(Number.isFinite))throw new TypeError('invalid neural weights');
   target.set(s[key]);
  }
  this.seed=s.seed>>>0;this.steps=s.steps;this.prevReward=Number.isFinite(s.prevReward)?s.prevReward:0;
 }
}
const api=Object.freeze({FlyBehavior});
if(typeof module==='object'&&module.exports)module.exports=api;
if(root)root.DevilPetBehavior=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:this);
