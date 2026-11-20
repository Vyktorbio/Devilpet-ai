#!/usr/bin/env node
/* Run the same unchanged reduced DevilPet neural core with no Three.js,
 * no browser and no cemetery. This is a separation/reproducibility demo,
 * not evidence of a biological fly's intelligence.
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const Source=fs.readFileSync(path.join(__dirname,'..','neural-engine.js'),'utf8');
const {ArchitecturalFlyBrain,FlyNeuroEthology}=new Function(
  Source+'\nreturn {ArchitecturalFlyBrain,FlyNeuroEthology};'
)();
const {FlyAgent}=require('./agent.js');
const senses=require('./sensors.js');
const physical=require('../environment/world-state.js');
const brain=new ArchitecturalFlyBrain('drosophila',42);
const odor=new FlyNeuroEthology(47);
const fly=new FlyAgent({getBrain:()=>brain,getOdor:()=>odor,sensors:senses});
const pose={x:0,y:.8,z:0,angle:0,vy:0};
const vitals={energy:.8,rest:.8,curiosity:.65,bond:.2};
const patches=[
 {x:5,z:0,odor:1,food:1},
 {x:-5,z:0,odor:.65,food:1},
 {x:0,z:5,odor:.8,food:1},
 {x:0,z:-5,odor:1.2,food:1}
];
let contactEvents=0;
for(let step=0;step<300;step++){
  const world=physical.snapshot({
    radius:15,fruits:patches,zones:[
      {id:'cyan',x:5,y:0,z:0},
      {id:'amber',x:-5,y:0,z:0},
      {id:'red',x:0,y:0,z:5},
      {id:'sky',x:0,y:3,z:-5}
    ],ball:{x:2,z:1},ambientLight:.8
  });
  const frame=fly.perceive(world,pose,vitals,{localHour:12});
  const {out,decision}=fly.react(frame,vitals,{modulation:step===150?1:0});
  const target=decision.target;
  if(target>=0){
    const scent=frame.odors[target];
    // Headless *body* model, deliberately independent of the neural model.
    const steer=(scent.left-scent.right)/(scent.left+scent.right+.015);
    pose.angle+=Math.max(-.15,Math.min(.15,steer*.05));
  }
  const velocity=(out.dnSpikes>0?.07:.035);
  pose.x=Math.max(-14,Math.min(14,pose.x+Math.cos(pose.angle)*velocity));
  pose.z=Math.max(-14,Math.min(14,pose.z+Math.sin(pose.angle)*velocity));
  if(frame.taste.food){contactEvents++;}
}
const result={
  mode:'headless-reduced-neural-reference',renderer:'none',
  steps:300,neuralTick:brain.tick,
  sensorChannels:Object.keys(fly.lastObservation),
  contactEvents,finalPosition:{x:pose.x,y:pose.y,z:pose.z},
  telemetry:brain.telemetry(),
  disclaimer:'No full biological CNS data were loaded in this demo.'
};
console.log(JSON.stringify(result,null,2));
if(result.neuralTick!==18000||!Number.isFinite(result.telemetry.meanLong)){
  throw Error('Headless neural simulation failed');
}
