/* DevilPet: renderer-independent environment snapshot.
 * The agent does not receive absolute target positions. Only sensors read this
 * snapshot, and pass observations to a neural controller.
 */
(function(root){
  'use strict';
  const number=(v,fallback=0)=>Number.isFinite(v)?v:fallback;
  const clone=(obj,keys)=>Object.fromEntries(keys.map(k=>[k,number(obj?.[k])]));
  function snapshot({zones=[],fruits=[],perches=[],walls=[],pillars=[],ball=null,blood=null,
                     radius=23,ambientLight=.6,airflow={x:0,z:0}}={}){
    return {
      radius:number(radius,23),
      ambientLight:number(ambientLight,.6),
      airflow:clone(airflow,['x','z']),
      zones:zones.map(z=>({
        ...clone(z,['x','y','z','radius']),
        id:String(z.id),aerial:!!z.aerial
      })),
      fruits:fruits.map(f=>({...clone(f,['x','z','odor','food']),identity:String(f.identity||f.kind||f.odorId||'fruit').slice(0,64)})),
      perches:perches.map(p=>({
        ...clone(p,['x','y','z','radius']),id:String(p.id)
      })),
      walls:walls.map(w=>clone(w,['x','z','w','d'])),
      pillars:pillars.map(p=>clone(p,['x','z','r'])),
      ball:ball?clone(ball,['x','z']):null,
      blood:blood&&blood.active?clone(blood,['x','z','amount']):null
    };
  }
  const api=Object.freeze({snapshot});
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.DevilPetWorldState=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:this);
