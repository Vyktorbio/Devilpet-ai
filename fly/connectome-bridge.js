/* Optional full-CNS bridge. A browser cannot load >1 GB real connectome
 * by itself. This adapter connects sensor frames to a separately running
 * native Rust graph process. It NEVER substitutes a fake graph.
 * No direct access to three.js, fly memory or body geometry.
 */
(function(root){
  'use strict';
  const KEYS=[
    'odor_left','odor_right','vision_left','vision_right',
    'mechanical_front','taste_food','touch','altitude','internal_state'
  ];
  const clamp=v=>Math.min(1,Math.max(0,Number.isFinite(v)?v:0));
  const isKnown=id=>id==='male-cns-v1.0-2026'||id==='banc-female-2026-v888';
  function encodeSensors(frame){
    if(!frame)throw new TypeError('sensor frame missing');
    const odors=Array.isArray(frame.odors)?frame.odors:[];
    const left=odors.reduce((x,s)=>x+clamp(s.left),0);
    const right=odors.reduce((x,s)=>x+clamp(s.right),0);
    return {
      odor_left:Math.tanh(left/2),odor_right:Math.tanh(right/2),
      vision_left:clamp(frame.vision?.left),vision_right:clamp(frame.vision?.right),
      mechanical_front:clamp(frame.mechanosense?.front),
      taste_food:clamp(frame.taste?.food||frame.taste?.blood),
      touch:frame.mechanosense?.contact?1:0,
      altitude:clamp(frame.proprioception?.altitude),
      internal_state:clamp(1-(frame.proprioception?.energy||1))
    };
  }
  class ConnectomeBridge{
    constructor({fetchImpl,now}={}){
      this._fetch=fetchImpl||root.fetch?.bind(root);
      this._now=now||(()=>Date.now());
      this.endpoint=null;
      this.health=null;
      this.connected=false;
      this.active=false;
      this.lastMotor=null;
      this.lastAt=0;
      this.error=null;
      this.sequence=0;
      this.inFlight=false;
      this.nextSendAt=0;
    }
    async getJSON(url,opts={}){
      const response=await this._fetch(url,{cache:'no-store',...opts});
      if(!response.ok)throw Error('HTTP '+response.status);
      return response.json();
    }
    async connect(endpoint){
      this.disconnect();
      const url=new URL(endpoint);
      if(!['https:','http:'].includes(url.protocol))throw Error('Use HTTPS ou endereço local');
      if(url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname)){
        throw Error('HTTP sem criptografia só é permitido em localhost');
      }
      const path=url.href.replace(/\/$/,'');
      const health=await this.getJSON(path+'/health');
      if(health?.schema!=='devilpet-cns-server-v1' ||
         health.status!=='graph_loaded_ports_reviewed' ||
         !isKnown(health.dataset_id) ||
         !Number.isInteger(health.node_count) || health.node_count<100000 ||
         !Number.isInteger(health.edge_count) || health.edge_count<=100000 ||
         !health.dataset_source?.startsWith('https://') ||
         !Array.isArray(health.available_motors) ||
         !['forward','turn_left','turn_right','lift'].every(x=>health.available_motors.includes(x))){
        throw Error('O serviço não comprovou um grafo CNS compatível e portas motoras revisadas');
      }
      this.endpoint=path;
      this.health=health;
      this.connected=true;
      this.error=null;
      return health;
    }
    activate(){
      if(!this.connected)throw Error('Nenhum CNS real conectado');
      if(!this.lastMotor || this._now()-this.lastAt>1500 ||
         this.lastMotor.activity<=0){
        throw Error('Aguarde resposta motora mensurável antes de ativar o controle CNS');
      }
      this.active=true;
    }
    deactivate(){this.active=false;}
    disconnect(){
      this.connected=false;this.active=false;this.health=null;
      this.endpoint=null;this.lastMotor=null;this.lastAt=0;
      this.inFlight=false;this.nextSendAt=0;
    }
    motor(){
      if(!this.active||!this.connected)return null;
      if(this._now()-this.lastAt>1100){
        this.active=false;
        this.error='Resposta do conectoma expirou; controle reduzido restaurado';
        return null;
      }
      return this.lastMotor;
    }
    async tick(frame){
      if(!this.connected||this.inFlight||this._now()<this.nextSendAt)return;
      this.inFlight=true;
      const sample_id=++this.sequence;
      const requestedAt=this._now();
      this.nextSendAt=requestedAt+300; // <=3.3 queries / second
      const controller=new AbortController();
      const timer=typeof root.setTimeout==='function'?
        root.setTimeout(()=>controller.abort(),2200):null;
      try{
        const response=await this.getJSON(this.endpoint+'/step',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({sample_id,hops:3,channels:encodeSensors(frame)}),
          signal:controller.signal
        });
        if(!this.connected||sample_id!==this.sequence)return;
        if(response?.schema!=='devilpet-cns-output-v1'||
           response.dataset_id!==this.health.dataset_id||
           response.dataset_version!==this.health.dataset_version||
           response.sample_id!==sample_id)throw Error('Resposta CNS incompatível');
        const m=response.motor;
        if(!m||!['forward','turn','lift','activity'].every(x=>Number.isFinite(m[x]))||
          m.forward<0||m.forward>1||Math.abs(m.turn)>1||m.lift<0||m.lift>1||
          m.activity<0)throw Error('Saída motora CNS fora dos limites');
        this.lastMotor={forward:m.forward,turn:m.turn,lift:m.lift,activity:m.activity};
        this.lastAt=this._now();
        this.error=null;
      }catch(error){
        this.error=error.message||String(error);
        this.active=false; // no silent fallback to invented motor signal
        this.lastMotor=null;
      }finally{
        if(timer!==null)root.clearTimeout?.(timer);
        this.inFlight=false;
      }
    }
    status(){
      return {
        connected:this.connected,active:this.active,
        dataset_id:this.health?.dataset_id||null,
        node_count:this.health?.node_count||0,
        edge_count:this.health?.edge_count||0,
        lastActivity:this.lastMotor?.activity||0,
        error:this.error
      };
    }
  }
  const api=Object.freeze({ConnectomeBridge,encodeSensors,KEYS});
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.DevilPetConnectomeBridge=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:this);
