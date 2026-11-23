const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {ResourceMemory, sampleResourceField, FlyNeuroEthology} = vm.runInNewContext(
  fs.readFileSync(require.resolve('../neural-engine.js'), 'utf8') +
  ';({ResourceMemory,sampleResourceField,FlyNeuroEthology})'
);
const position = {x:0,y:0,z:0};
const field = x => sampleResourceField({active:true,x,z:0}, position);
const off = sampleResourceField({active:false}, position);
const thirsty = {energy:1,hydration:0.2,rest:0.8,curiosity:0.7};
const memory = new ResourceMemory();
const xPull = (waterX, pet) => memory.steer([off,field(waterX)],pet).x;
assert.equal(xPull(3,thirsty),0);
for (let i=0;i<120;i++) memory.observe([off,field(0)],0,0,1/60);
assert.equal(xPull(3,thirsty),0);
for (let i=0;i<120;i++) memory.observe([off,field(0)],0,0.002,1/60);
assert.ok(xPull(3,thirsty)>0);
assert.equal(xPull(-3,thirsty),-xPull(3,thirsty));
assert.equal(xPull(3,{...thirsty,hydration:1}),0);
assert.equal(xPull(8,thirsty),0);
assert.equal(memory.steer([field(3),off],thirsty).x,0);
assert.equal(memory.steer([off,off],thirsty).x,0);
assert.deepEqual(new ResourceMemory(Array.from(memory.weights)).weights,memory.weights);
assert.deepEqual(new ResourceMemory(undefined).weights,new ResourceMemory().weights);
const foodMemory=new ResourceMemory();
foodMemory.observe([field(0),off],0.2,0,1/60);
assert.ok(foodMemory.steer([field(3),off],{energy:0.2,hydration:1}).x>0);
assert.equal(foodMemory.steer([field(3),off],thirsty).x,0);
let before=0,after=0;
for(let seed=1;seed<=256;seed++) {
  const choice = interest => new FlyNeuroEthology(seed).choose([],thirsty,interest).activity;
  if(choice(0)==='alimentar') before++;
  if(choice(xPull(3,thirsty))==='alimentar') after++;
}
assert.ok(after>before && after<256);
console.log({seeds:256,resourceChoicesBefore:before,resourceChoicesAfter:after});
