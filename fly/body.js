/* Experimental body adapter. No DOM or rendering; receives motor outputs, never target positions. */
(function(root){
'use strict';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,Number.isFinite(x)?x:0));
class FlyBody {
 constructor({x=0,z=0,y=.35,angle=0,radius=15}={}){this.pose={x,z,y,angle,vy:0};this.radius=radius;this.collisions=0;this.distance=0;}
 step(motor,dt=.1){
  if(!Number.isFinite(dt)||dt<=0||dt>1)throw new RangeError('dt');
  if(!motor||!Number.isFinite(motor.forward)||!Number.isFinite(motor.turn)||!Number.isFinite(motor.lift))throw new TypeError('motor');
  const p=this.pose;
  p.angle=Math.atan2(Math.sin(p.angle+clamp(motor.turn,-1,1)*dt*2.8),Math.cos(p.angle+clamp(motor.turn,-1,1)*dt*2.8));
  const velocity=clamp(motor.forward,0,1)*2.5;
  const nx=p.x+Math.cos(p.angle)*velocity*dt,nz=p.z+Math.sin(p.angle)*velocity*dt;
  if(Math.hypot(nx,nz)>this.radius-.5){this.collisions++;p.angle=Math.atan2(Math.sin(p.angle+Math.PI*.65),Math.cos(p.angle+Math.PI*.65));}
  else{p.x=nx;p.z=nz;this.distance+=velocity*dt;}
  p.vy=clamp(p.vy*.82+(clamp(motor.lift,0,1)-.14)*dt,-.6,.6);
  p.y=clamp(p.y+p.vy*dt,.25,2.6);
  return {...p};
 }
}
const api=Object.freeze({FlyBody});
if(typeof module==='object'&&module.exports)module.exports=api;
if(root)root.DevilPetBody=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:this);
