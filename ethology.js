/* DevilPet — Diário de Etologia v1. Observador passivo: não altera o cérebro. */
(() => {
  'use strict';
  const KEY = 'devilpet_ethology_v1';
  const PET_KEY = 'drosophila_3d_trainer_v1';
  const GRID = 12, MAX_SAMPLES = 8000, MAX_EVENTS = 1200, MAX_DAYS = 365;
  const labels = {sleep:'Dormindo', feed:'Alimentando', play:'Brincando', perch:'Pousada', fly:'Voando', ground:'No solo'};
  function empty() { return {version:1, days:{}, events:[], samples:[]}; }
  function readStore() {
    try {
      const x = JSON.parse(localStorage.getItem(KEY) || 'null');
      if(x && x.version === 1 && x.days && Array.isArray(x.events) && Array.isArray(x.samples)) return x;
    } catch (_) {}
    return empty();
  }
  let data = readStore();
  function dayKey(d) {
    return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
  }
  function today() {
    const key = dayKey(new Date());
    if (!data.days[key]) data.days[key] = {
      seconds:0, distance:0, times:{sleep:0,feed:0,play:0,perch:0,fly:0,ground:0},
      perches:{}, cells:Array(GRID*GRID).fill(0), assistedSeconds:0, foodVisits:0
    };
    return data.days[key];
  }
  function limit() {
    if(data.samples.length > MAX_SAMPLES) data.samples.splice(0, data.samples.length-MAX_SAMPLES);
    if(data.events.length > MAX_EVENTS) data.events.splice(0, data.events.length-MAX_EVENTS);
    const keys = Object.keys(data.days).sort();
    while(keys.length > MAX_DAYS) delete data.days[keys.shift()];
  }
  function log(type, detail) {
    data.events.push({time:new Date().toISOString(), type:type, detail:detail || '', tier:brain.tierKey});
    limit();
    render();
  }
  let storageError=false;
  function persist() {
    try {
      limit();
      localStorage.setItem(KEY, JSON.stringify(data));
      storageError = false;
    } catch(e) { storageError = true; }
    const warning = document.getElementById('eth-storage');
    if(warning) warning.textContent = storageError
      ? 'Armazenamento cheio ou bloqueado: exporte seus dados agora.'
      : 'Salvamento automático local a cada 30 segundos. Exporte um backup para guardar fora do navegador.';
  }
  function classify() {
    if (sleeping) return {name:'sleep', perch:null};
    if (nectarState.active && Math.hypot(nectarState.x-flyPos.x, nectarState.z-flyPos.z)<1.15 && flyPos.y<0.6) return {name:'feed',perch:null};
    if (pet.curiosity>0.45 && Math.hypot(ballState.x-flyPos.x,ballState.z-flyPos.z)<1.1) return {name:'play',perch:null};
    const p=detectPerch();
    if (p && pet.rest<0.72) return {name:'perch',perch:p};
    return {name:flyPos.y>0.28?'fly':'ground',perch:null};
  }
  function gridIndex() {
    const r = Number.isFinite(ARENA_RADIUS) ? ARENA_RADIUS : 23;
    const axis = v => Math.min(GRID-1,Math.max(0,Math.floor((v+r)/(2*r)*GRID)));
    return axis(flyPos.z)*GRID+axis(flyPos.x);
  }
  function entropy(cells) {
    const n=cells.reduce((a,b)=>a+b,0);
    if(!n) return 0;
    return cells.reduce((sum,c)=>{const p=c/n;return p>0?sum-p*Math.log(p):sum;},0);
  }
  function download(filename, content, type) {
    const a=document.createElement('a'), u=URL.createObjectURL(new Blob([content],{type:type}));
    a.href=u;a.download=filename;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(u),1000);
  }
  function backup() {
    persist();
    let checkpoint=null;
    try {checkpoint=JSON.parse(localStorage.getItem(PET_KEY)||'null');} catch(_){}
    download('devilpet-backup-'+dayKey(new Date())+'.json',
      JSON.stringify({format:'devilpet-backup-v1',createdAt:new Date().toISOString(),checkpoint:checkpoint,ethology:data},null,2),
      'application/json;charset=utf-8');
  }
  function csv() {
    const header=['data_iso','x','y','z','estado','guiado','energia','descanso','vinculo','arquitetura'];
    const rows=data.samples.map(s=>s.map(v=>String(v).replace(/"/g,'""')).map(v=>'"'+v+'"').join(';'));
    download('devilpet-etologia-'+dayKey(new Date())+'.csv','\uFEFF'+[header.join(';'),...rows].join('\r\n'),'text/csv;charset=utf-8');
  }
  function render() {
    const d = today(), seconds=d.seconds;
    const labelTime=t=> t>=3600?(t/3600).toFixed(1)+' h':t>=60?Math.round(t/60)+' min':Math.round(t)+' s';
    const activeCells=d.cells.filter(x=>x>0).length;
    const ordered=Object.entries(d.perches).sort((a,b)=>b[1]-a[1]);
    const top=ordered.length?ordered[0][0]+' ('+Math.round(100*ordered[0][1]/Math.max(0.01,d.times.perch))+'% do tempo pousada)':'Ainda sem pousos registrados';
    const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
    set('eth-total',labelTime(seconds));
    set('eth-distance',d.distance.toFixed(1)+' unidades');
    set('eth-cells',activeCells+'/'+(GRID*GRID)+' áreas');
    set('eth-entropy',entropy(d.cells).toFixed(2)+' nats');
    set('eth-perch',top);
    set('eth-assisted',labelTime(d.assistedSeconds));
    const pieces=Object.entries(labels).map(([k,v])=>v+': '+labelTime(d.times[k]||0));
    set('eth-actions',pieces.join(' · '));
    const logEl=document.getElementById('eth-events');
    if(logEl) {
      logEl.replaceChildren();
      const recent=data.events.slice(-12).reverse();
      if(!recent.length){const li=document.createElement('li');li.textContent='Sem eventos registrados ainda.';logEl.appendChild(li);}
      recent.forEach(x=>{const li=document.createElement('li');li.textContent=new Date(x.time).toLocaleString('pt-BR')+' — '+x.type+(x.detail?' · '+x.detail:'');logEl.appendChild(li);});
    }
    const canvas=document.getElementById('eth-heat');
    if(canvas){
      const ctx=canvas.getContext('2d'), cell=canvas.width/GRID;
      const max=Math.max(0.01,...d.cells);
      ctx.clearRect(0,0,canvas.width,canvas.height);
      d.cells.forEach((s,i)=>{
        const intensity=s?0.16+0.84*Math.sqrt(s/max):0.025;
        ctx.fillStyle='rgba(124,93,220,'+intensity.toFixed(3)+')';
        ctx.fillRect((i%GRID)*cell+1,Math.floor(i/GRID)*cell+1,cell-2,cell-2);
      });
    }
  }
  // Visual panel. The existing 3D canvas and all neural code stay unchanged.
  const panel=document.createElement('section');
  panel.className='card';
  panel.id='ethology-panel';
  panel.style.marginTop='10px';
  panel.innerHTML='<h2>Diário automático de Etologia</h2>'+
    '<p style="font-size:12px;color:var(--muted)">Observações da simulação, não provas de aprendizagem. Somente enquanto o jogo estiver aberto e rodando.</p>'+
    '<div class="metrics">'+
    '<div class="metric"><div class="label">Observação hoje</div><div class="val" id="eth-total">0 s</div></div>'+
    '<div class="metric"><div class="label">Distância 3D</div><div class="val" id="eth-distance">0</div></div>'+
    '<div class="metric"><div class="label">Exploração</div><div class="val" id="eth-cells">0</div></div>'+
    '<div class="metric"><div class="label">Entropia Shannon</div><div class="val" id="eth-entropy">0</div></div>'+
    '</div>'+
    '<p style="font-size:12px"><strong>Poleiro preferido:</strong> <span id="eth-perch">Aguardando</span></p>'+
    '<p style="font-size:12px"><strong>Tempo com comando ativo:</strong> <span id="eth-assisted">0 s</span></p>'+
    '<p id="eth-actions" style="font-size:12px;color:var(--muted)"></p>'+
    '<canvas id="eth-heat" width="240" height="240" role="img" aria-label="Mapa de calor das 144 áreas do cemitério" style="width:100%;max-width:240px;height:auto;border:1px solid var(--border);border-radius:10px;background:#0b1020"></canvas>'+
    '<div class="divider"></div>'+
    '<strong>Últimos acontecimentos</strong><ul id="eth-events" style="font-size:12px;line-height:1.7;max-height:220px;overflow:auto;padding-left:20px"></ul>'+
    '<div class="btn-group"><button type="button" id="eth-export-json">Exportar backup JSON</button>'+
    '<button type="button" id="eth-export-csv">Exportar dados CSV</button></div>'+
    '<details style="margin-top:14px"><summary style="cursor:pointer">Configurações e memória</summary>'+
    '<div style="margin-top:10px;display:grid;gap:8px">'+
    '<span id="eth-reset-slot"></span>'+
    '<label style="font-size:12px">Importar backup JSON <input type="file" accept=".json,application/json" id="eth-import" style="width:100%;margin-top:4px"></label>'+
    '<button type="button" id="eth-clear">Limpar apenas o diário</button>'+
    '</div></details>'+
    '<p id="eth-storage" style="font-size:11px;color:var(--muted)"></p>';
  document.querySelector('.stage-col').appendChild(panel);
  // Move the preexisting reset control instead of replacing its neural operation.
  const reset=document.getElementById('btn-reset-weights');
  document.getElementById('eth-reset-slot').appendChild(reset);
  reset.addEventListener('click',e=>{
    if(!confirm('Zerar a memória neural desta diabinha? Exporte um backup JSON antes. Essa ação não pode ser desfeita.')){
      e.preventDefault();e.stopImmediatePropagation();
    } else {log('Memória neural zerada','Confirmação do cuidador');persist();}
  },true);
  document.getElementById('eth-export-json').addEventListener('click',backup);
  document.getElementById('eth-export-csv').addEventListener('click',csv);
  document.getElementById('eth-clear').addEventListener('click',()=>{
    if(confirm('Limpar somente o histórico de etologia? Isso não apaga a memória neural.')){
      data=empty();persist();render();
    }
  });
  document.getElementById('eth-import').addEventListener('change',async e=>{
    const f=e.target.files&&e.target.files[0];if(!f)return;
    try {
      if(f.size>12_000_000)throw new Error('Arquivo muito grande.');
      const obj=JSON.parse(await f.text());
      if(obj.format!=='devilpet-backup-v1'||!obj.checkpoint||!obj.ethology||!obj.ethology.days||
         !Array.isArray(obj.ethology.events)||!Array.isArray(obj.ethology.samples)||
         !Array.isArray(obj.checkpoint.shortW)||!Array.isArray(obj.checkpoint.longW)||
         !['drosophila','expanded','bee','super'].includes(obj.checkpoint.tierKey))
        throw new Error('Arquivo incompatível.');
      if(!confirm('Restaurar este backup? O estado atual e o diário serão substituídos.'))return;
      localStorage.setItem(PET_KEY,JSON.stringify(obj.checkpoint));
      data=obj.ethology;persist();
      location.reload();
    } catch(err) {alert('Não foi possível importar: '+err.message);}
    finally {e.target.value='';}
  });
  // Caregiver interventions recorded distinctly from spontaneous behavior.
  [['btn-feed','Sangue oferecido'],['btn-ball','Bolinha lançada'],['btn-takeoff','Decolagem comandada'],
   ['btn-sleep','Sono controlado'],['btn-pos','PAM aplicado'],['btn-neg','PPL1 aplicado'],
   ['btn-save','Checkpoint salvo'],['btn-load','Checkpoint restaurado']]
   .forEach(([id,name])=>{
      const el=document.getElementById(id);
      if(el)el.addEventListener('click',()=>log(name,'posição '+flyPos.x.toFixed(1)+','+flyPos.z.toFixed(1)),true);
   });
  const viewport=document.getElementById('viewport');
  if(viewport)viewport.addEventListener('pointerup',()=>{if(placeMode==='call')log('Chamado do cuidador','comando de movimento');},false);

  let lastFrame=performance.now(),lastSample=0,lastSave=performance.now(),lastRender=0;
  let prevState=null,prevPerch=null;
  const oldStep=stepSimulation;
  stepSimulation=function(...args){
    const before={x:flyPos.x,y:flyPos.y,z:flyPos.z};
    const result=oldStep.apply(this,args);
    const now=performance.now();
    const dt=Math.max(0,Math.min(0.10,(now-lastFrame)/1000));
    lastFrame=now;
    const d=today(),state=classify(), assisted=!!(callTarget.active||flightBoostTimer>0);
    if(dt>0){
      d.seconds+=dt;
      d.times[state.name]=(d.times[state.name]||0)+dt;
      d.distance+=Math.hypot(flyPos.x-before.x,flyPos.y-before.y,flyPos.z-before.z);
      if(state.perch)d.perches[state.perch.label]=(d.perches[state.perch.label]||0)+dt;
      d.cells[gridIndex()]+=dt;
      if(assisted)d.assistedSeconds+=dt;
    }
    if(prevState!==state.name || prevPerch!==(state.perch?state.perch.id:null)){
      if(state.name==='sleep')log('Adormeceu','');
      else if(prevState==='sleep')log('Acordou','');
      else if(state.name==='feed'){d.foodVisits++;log('Alimentação observada','');}
      else if(state.name==='perch')log('Pouso observado',state.perch.label);
      prevState=state.name;prevPerch=state.perch?state.perch.id:null;
    }
    if(now-lastSample>2000){
      lastSample=now;
      data.samples.push([new Date().toISOString(),+flyPos.x.toFixed(3),+flyPos.y.toFixed(3),+flyPos.z.toFixed(3),
        state.name,assisted?1:0,+pet.energy.toFixed(4),+pet.rest.toFixed(4),+pet.bond.toFixed(4),brain.tierKey]);
      limit();
    }
    if(now-lastRender>4000){lastRender=now;render();}
    if(now-lastSave>30000){lastSave=now;persist();}
    return result;
  };
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')persist();});
  window.addEventListener('pagehide',persist);
  render();persist();
})();
