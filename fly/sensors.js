/* DevilPet sensory organ layer: independent of Three.js, WASM and DOM.
 * Stimulus intensities are virtual units, not calibrated Drosophila physiology.
 * Never returns coordinates of reward targets to the brain.
 */
(function(root){
  'use strict';
  const clamp=(v,min=0,max=1)=>Math.min(max,Math.max(min,v));
  const norm=(a)=>Math.atan2(Math.sin(a),Math.cos(a));
  const rayCircle=(x,z,dx,dz,cx,cz,r,max)=>{
    const ox=x-cx,oz=z-cz;
    const b=ox*dx+oz*dz;
    const c=ox*ox+oz*oz-r*r;
    const disc=b*b-c;
    if(disc<0)return max;
    const t=-b-Math.sqrt(disc);
    return t>=0?Math.min(max,t):c<=0?0:max;
  };
  const rayRect=(x,z,dx,dz,w,max)=>{
    const minX=w.x-w.w/2,maxX=w.x+w.w/2;
    const minZ=w.z-w.d/2,maxZ=w.z+w.d/2;
    let near=0,far=max;
    for(const [p,d,lo,hi] of [[x,dx,minX,maxX],[z,dz,minZ,maxZ]]){
      if(Math.abs(d)<1e-9){if(p<lo||p>hi)return max;continue;}
      const a=(lo-p)/d,b=(hi-p)/d;
      near=Math.max(near,Math.min(a,b));
      far=Math.min(far,Math.max(a,b));
      if(far<near)return max;
    }
    return near<=max?near:max;
  };
  function rays(world,pose,range=8){
    const distances=[];
    const angles=[pose.angle+.6,pose.angle,pose.angle-.6];
    for(const ang of angles){
      const dx=Math.cos(ang),dz=Math.sin(ang);
      let dist=range;
      // Arena border, a physical limit rather than a navigational target.
      for(const [p,d] of [[pose.x,dx],[pose.z,dz]]){
        if(Math.abs(d)>1e-9){
          const boundary=d>0?world.radius:-world.radius;
          const t=(boundary-p)/d;
          if(t>=0)dist=Math.min(dist,t);
        }
      }
      if(pose.y<=2.65){
        for(const w of world.walls||[])dist=Math.min(dist,rayRect(pose.x,pose.z,dx,dz,w,range));
        for(const c of world.pillars||[])dist=Math.min(dist,rayCircle(pose.x,pose.z,dx,dz,c.x,c.z,c.r+.55,range));
      }
      distances.push(Math.max(0,dist));
    }
    return distances; // left, forward, right, all in world units
  }
  function vision(world,pose){
    const items=[];
    const candidates=[
      ...(world.ball?[{type:'moving-object',x:world.ball.x,z:world.ball.z,y:0.2,contrast:.9}]:[]),
      ...(world.blood?[{type:'food-drop',x:world.blood.x,z:world.blood.z,y:0.2,contrast:.7}]:[]),
    ];
    for(const p of world.perches||[])candidates.push({type:'elevated-surface',x:p.x,z:p.z,y:p.y,contrast:.45});
    for(const obj of candidates){
      const dx=obj.x-pose.x,dz=obj.z-pose.z;
      const distance=Math.hypot(dx,dz);
      const relative=norm(Math.atan2(dz,dx)-pose.angle);
      if(Math.abs(relative)>Math.PI*.72)continue;
      const signal=obj.contrast*Math.max(0,1-distance/22)*clamp(world.ambientLight,.1,1);
      items.push({type:obj.type,bearing:relative,intensity:signal});
    }
    const left=items.filter(o=>o.bearing>0).reduce((s,o)=>s+o.intensity,0);
    const right=items.filter(o=>o.bearing<0).reduce((s,o)=>s+o.intensity,0);
    return {left:clamp(left),right:clamp(right),contrast:clamp(left+right),
      elevation:clamp(pose.y/5.4)};
  }
  function sample(world,pose,vitals,{sleeping=false,localHour=null,localMinute=0}={}){
    if(!world||!pose||!vitals)throw new TypeError('world, pose and vitals required');
    const a=pose.angle,offset=.7;
    const lx=pose.x-Math.sin(a)*offset,lz=pose.z+Math.cos(a)*offset;
    const rx=pose.x+Math.sin(a)*offset,rz=pose.z-Math.cos(a)*offset;
    const odors=[];
    for(const f of world.fruits||[]){
      const odor=(x,z)=>f.odor*f.food/(1+.085*((x-f.x)**2+(z-f.z)**2));
      odors.push({food:Math.max(0,odor(pose.x,pose.z)),
        left:odor(lx,lz),right:odor(rx,rz)});
    }
    // Same five cue channels, geometry and numerical mapping as the original pet.
    // This translation is compatibility plumbing, not a new neural rule.
    const cues={cyan:0,amber:0,red:0,ball:0,sky:0};
    for(const zone of world.zones||[]){
      const distance=Math.hypot(pose.x-zone.x,pose.y-zone.y,pose.z-zone.z);
      if(Object.hasOwn(cues,zone.id))cues[zone.id]=Math.max(0,1-distance/11.5);
    }
    if(world.ball){
      const distance=Math.hypot(pose.x-world.ball.x,pose.y,pose.z-world.ball.z);
      cues.ball=Math.max(0,1-distance/9);
    }
    const distance=rays(world,pose);
    const touch=distance[1]<=.55;
    const foodContact=(world.fruits||[]).some(f=>
      Math.hypot(f.x-pose.x,f.z-pose.z)<1.25 && pose.y<.72 && f.food>.02);
    const bloodContact=!!world.blood && pose.y<.6 &&
      Math.hypot(pose.x-world.blood.x,pose.z-world.blood.z)<1.15;
    const hour=Number.isInteger(localHour)&&localHour>=0&&localHour<24?localHour:null;
    const phase=hour===null?null:(hour+clamp(localMinute,0,59)/60)/24;
    return {
      version:1,
      cues,
      odors,
      vision:vision(world,pose),
      mechanosense:{left:clamp(1-distance[0]/8),front:clamp(1-distance[1]/8),
        right:clamp(1-distance[2]/8),contact:touch},
      taste:{food:foodContact?1:0,blood:bloodContact?1:0},
      proprioception:{
        altitude:clamp(pose.y/5.4),verticalVelocity:clamp((pose.vy||0)/.5,-1,1),
        headingSin:Math.sin(pose.angle),headingCos:Math.cos(pose.angle),
        energy:clamp(vitals.energy),rest:clamp(vitals.rest),
        curiosity:clamp(vitals.curiosity),bond:clamp(vitals.bond),
        asleep:!!sleeping
      },
      airflow:{forward:(world.airflow?.x||0)*Math.cos(a)+(world.airflow?.z||0)*Math.sin(a),
        lateral:-(world.airflow?.x||0)*Math.sin(a)+(world.airflow?.z||0)*Math.cos(a)},
      clock:{localPhase:phase,night:hour===null?null:(hour>=22||hour<7)}
    };
  }
  const api=Object.freeze({sample});
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.DevilPetSensors=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:this);
