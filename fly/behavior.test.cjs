const assert=require('node:assert/strict');
const {FlyBehavior}=require('./behavior.js');
function frame({left=.3,right=.1,energy=.2,rest=.9,front=0,curiosity=.5,contact=false}={}){
 return {odors:[{left,right}],vision:{left:0,right:0,contrast:0},mechanosense:{left:0,right:0,front,contact},taste:{food:false},proprioception:{energy,rest,curiosity},airflow:{forward:0}};
}
const a=new FlyBehavior({seed:4}),b=new FlyBehavior({seed:4});
for(let i=0;i<100;i++)assert.deepEqual(a.step(frame()),b.step(frame()));
assert.equal(a.mode,'feed');
assert.ok(a.step(frame()).turn>-.5);
const before=a.values.get('odor')||0;
a.step(frame(),{reward:1});assert.ok(a.values.get('odor')>before);
const positive=a.values.get('odor');
a.step(frame(),{reward:-1});assert.ok(a.values.get('odor')<positive);
const threat=a.step(frame({front:1,contact:true}));assert.equal(threat.mode,'avoid');
const tired=a.step(frame({energy:1,rest:0,curiosity:0}));assert.equal(tired.mode,'rest');assert.equal(tired.forward,0);
const saved=a.snapshot(),c=new FlyBehavior();c.restore(saved);
assert.deepEqual(c.snapshot(),saved);
assert.throws(()=>c.restore({...saved,values:{odor:Infinity}}));
assert.throws(()=>c.step(frame(),{dt:0}));
assert.throws(()=>c.step({}));
c.sleep({durationSeconds:120});assert.ok(Math.abs(c.values.get('odor'))<=Math.abs(saved.values.odor));
console.log('PASS: deterministic perception, motivation, conditioning, sleep retention, snapshot, invalid inputs');
