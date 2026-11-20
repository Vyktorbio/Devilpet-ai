// Test independent sensors against the original DevilPet geometric equations.
// Run: node fly/sensors.test.cjs (no browser or Three.js required).
'use strict';
const assert=require('node:assert/strict');
const world=require('../environment/world-state.js');
const sensors=require('./sensors.js');
const {FlyAgent}=require('./agent.js');
const close=(a,b,msg)=>assert.ok(Math.abs(a-b)<1e-12,(msg||'')+': '+a+' != '+b);
const zones=[
 {id:'cyan',x:-7.2,y:0,z:-4.7},
 {id:'amber',x:7.4,y:0,z:-5.8},
 {id:'red',x:5.6,y:0,z:8.2},
 {id:'sky',x:-1.8,y:5.2,z:-9.6}
];
const fruits=[
 {x:-7.2,z:-4.7,odor:1,food:1},
 {x:7.4,z:-5.8,odor:.65,food:1},
 {x:5.6,z:8.2,odor:.9,food:1},
 {x:-6.4,z:8.4,odor:1.3,food:1},
];
const pose={x:2.7,y:1.2,z:-1.4,angle:1.3,vy:.02};
const pet={energy:.8,rest:.7,curiosity:.6,bond:.5};
const view=world.snapshot({
 radius:23,zones,fruits,perches:[{id:'p1',x:-1.8,y:5.2,z:-9.6,radius:1.5}],
 ball:{x:3,z:2},blood:{active:true,x:1,z:1,amount:1},
 ambientLight:.7,
 walls:[{x:4,z:1,w:1,d:5}],
 pillars:[{x:8,z:0,r:1}]
});
const s=sensors.sample(view,pose,pet,{sleeping:false,localHour:23,localMinute:30});
for(const z of zones){
 const expected=Math.max(0,1-Math.hypot(pose.x-z.x,pose.y-z.y,pose.z-z.z)/11.5);
 close(s.cues[z.id],expected,'legacy cue '+z.id);
}
close(s.cues.ball,Math.max(0,1-Math.hypot(pose.x-3,pose.y,pose.z-2)/9));
const left={x:pose.x-Math.sin(pose.angle)*.7,z:pose.z+Math.cos(pose.angle)*.7};
const right={x:pose.x+Math.sin(pose.angle)*.7,z:pose.z-Math.cos(pose.angle)*.7};
for(let i=0;i<fruits.length;i++){
 const f=fruits[i],fn=(x,z)=>f.odor*f.food/(1+.085*((x-f.x)**2+(z-f.z)**2));
 close(s.odors[i].food,fn(pose.x,pose.z));
 close(s.odors[i].left,fn(left.x,left.z));
 close(s.odors[i].right,fn(right.x,right.z));
}
assert.equal(s.clock.night,true);
assert.equal(s.taste.food,0);
assert.ok(s.proprioception.altitude>0);
assert.ok(s.mechanosense.front>=0 && s.mechanosense.front<=1);
assert.ok(s.vision.contrast>=0 && s.vision.contrast<=1);
assert.equal('x' in s,false,'agent must not see environment coordinates');
assert.equal('fruits' in s,false,'agent must not see world objects');
const sleep=sensors.sample(view,pose,pet,{sleeping:true,localHour:12});
assert.equal(sleep.proprioception.asleep,true);
assert.equal(sleep.clock.night,false);
let callLog=[];
const fakeBrain={tierKey:'drosophila',stepWindow:(c,m,con,learn,dur)=>{
 callLog.push({c,m,con,learn,dur});return {dnSpikes:4};}};
const fakeOdor={choose:(signals,vitals)=>({activity:'explorar',target:0,
  odorValue:signals[0].food+vitals.energy})};
const fly=new FlyAgent({getBrain:()=>fakeBrain,getOdor:()=>fakeOdor,sensors});
const frame=fly.perceive(view,pose,pet,{localHour:13});
const result=fly.react(frame,pet,{modulation:1,consolidate:.02,sleeping:false,durationMs:15});
assert.equal(result.out.dnSpikes,4);
assert.equal(result.decision.activity,'explorar');
assert.equal(callLog.length,1);
assert.equal(callLog[0].m,1);
assert.equal(callLog[0].learn,true);
assert.deepEqual(callLog[0].c,s.cues);
fly.react(frame,pet,{modulation:1,consolidate:.85,sleeping:true});
assert.equal(callLog[1].m,0);
assert.equal(callLog[1].learn,false);
assert.equal(fly.status.model,'javascript-reduced');
console.log('PASS: legacy 5 cues, antenna gradients, seven sensor categories and independent fly brain port.');
