'use strict';
const assert=require('node:assert/strict');
const {ConnectomeBridge,encodeSensors}=require('./connectome-bridge.js');
const frame={
  odors:[{food:.2,left:.4,right:.1},{food:.5,left:.3,right:.5}],
  vision:{left:.1,right:.8},
  mechanosense:{front:.6,contact:false},
  taste:{food:1,blood:0},proprioception:{altitude:.5,energy:.65}
};
const channels=encodeSensors(frame);
assert.ok(channels.odor_left>0 && channels.odor_right>0);
assert.equal(channels.taste_food,1);
assert.equal(channels.internal_state,.35);
const health={
 schema:'devilpet-cns-server-v1',
 backend:'python',
 status:'graph_loaded_ports_reviewed',
 dataset_id:'male-cns-v1.0-2026',dataset_version:'v1.0',
 dataset_source:'https://male-cns.janelia.org/download/',
 node_count:166691,edge_count:152000000,
 available_motors:['forward','turn_left','turn_right','lift']
};
let ms=10000,posted=0;
const fetchImpl=async(url,opts={})=>{
 if(url.endsWith('/health'))return {ok:true,json:async()=>health};
 if(url.endsWith('/step')){
   posted++;
   const body=JSON.parse(opts.body);
   assert.equal(body.hops,3);
   assert.equal(body.channels.taste_food,1);
   return {ok:true,json:async()=>({
      schema:'devilpet-cns-output-v1',sample_id:body.sample_id,
      dataset_id:health.dataset_id,dataset_version:health.dataset_version,
      motor:{forward:.4,turn:-.3,lift:.2,activity:1.5}
   })};
 }
 throw Error('unexpected URL '+url);
};
async function test(){
 const bridge=new ConnectomeBridge({fetchImpl,now:()=>ms});
 assert.equal(bridge.connected,false);
 await assert.rejects(bridge.connect('http://remote.example'),/HTTP sem criptografia/);
 await bridge.connect('http://127.0.0.1:8326');
 assert.equal(bridge.connected,true);
 assert.equal(bridge.active,false,'never activate CNS from a network connection alone');
 assert.throws(()=>bridge.activate(),/resposta motora/);
 await bridge.tick(frame);
 assert.equal(posted,1);
 bridge.activate();
 assert.equal(bridge.motor().forward,.4);
 ms+=1500;
 assert.equal(bridge.motor(),null,'stale network output cannot keep motor control');
 assert.equal(bridge.active,false);
 bridge.disconnect();
 assert.equal(bridge.connected,false);
 const fake={...health,dataset_id:'fabricated-test',node_count:600};
 const invalid=new ConnectomeBridge({fetchImpl:async()=>({ok:true,json:async()=>fake})});
 await assert.rejects(invalid.connect('http://localhost:8326'),/não comprovou/);
 console.log('PASS: real-graph handshake, sensor encoding, explicit activation, stale-response rollback.');
}
test().catch(e=>{console.error(e);process.exitCode=1;});
