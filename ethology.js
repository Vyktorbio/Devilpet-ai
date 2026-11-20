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
      perches:{}, cells:Array(GRID*GRID).fill(0), assistedSeconds:0, foodVisits:0,
      areas:{}, freeAreas:{}, sleepAreas:{}, visits:{}, notices:{}
    };
    const d = data.days[key];
    // Upgrade historic v1 days in place; never discard saved observations.
    for (const field of ['areas','freeAreas','sleepAreas','visits','notices']) {
      if(!d[field] || typeof d[field] !== 'object') d[field] = {};
    }
    if(!data.milestones || typeof data.milestones !== 'object') data.milestones = {};
    return d;
  }
  function areaAt(pos) {
    // The location label is observational: it does not affect locomotion or input cues.
    for (const perch of PERCHES) {
      if (Math.hypot(pos.x-perch.x,pos.z-perch.z) <= perch.radius+0.65 &&
          Math.abs(pos.y-perch.y)<=1.3) return 'Pináculo: '+perch.label;
    }
    for(let i=0;i<HABITAT_FRUITS.length;i++){
      const f=HABITAT_FRUITS[i];
      if(Math.hypot(pos.x-f.x,pos.z-f.z)<2.8 && pos.y<2.1) return 'Ponto de alimento '+(i+1);
    }
    if(Math.abs(pos.x)<6 && Math.abs(pos.z)<6) return 'Centro do cemitério';
    if(pos.z < -6) return pos.x<0?'Ala norte-oeste':'Ala norte-leste';
    if(pos.z > 6) return pos.x<0?'Ala sul-oeste':'Ala sul-leste';
    return pos.x < 0 ? 'Ala oeste' : 'Ala leste';
  }
  const showTime = t => t>=3600?(t/3600).toFixed(1)+' h':t>=60?Math.round(t/60)+' min':Math.round(t)+' s';
  function rankings(obj) { return Object.entries(obj||{}).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]); }
  function topPlace(d,property='freeAreas') {
    const ranks=rankings(d?.[property]);
    return ranks.length?ranks[0]:null;
  }
  function summaryFor(d) {
    if(!d || !d.seconds) return 'Ainda não há tempo observado suficiente.';
    const focus = topPlace(d);
    const location = focus ? focus[0]+' ('+Math.round(100*focus[1]/Math.max(0.01,Object.values(d.freeAreas).reduce((a,b)=>a+b,0)))+'% do tempo livre)' : 'ainda sem tempo livre suficiente';
    return 'Observação de '+showTime(d.seconds)+'. Local mais frequentado sem comando: '+location+
      '. Voo: '+showTime(d.times?.fly||0)+', descanso: '+showTime(d.times?.sleep||0)+
      ', interação com a bolinha: '+showTime(d.times?.play||0)+'.';
  }
  function milestone(id,title,description) {
    if(!data.milestones) data.milestones={};
    if(data.milestones[id]) return;
    data.milestones[id]={time:new Date().toISOString(),title,description};
    log('Marco da diabinha',title);
  }
  function observations(d,state) {
    if (state.name==='sleep') milestone('firstSleep','Primeiro sono observado','Repouso registrado pelo diário');
    if (state.name==='feed') milestone('firstFeed','Primeira alimentação observada','Aproximação da gota de sangue');
    if (state.name==='play') milestone('firstPlay','Primeira interação com a bolinha','Proximidade da bolinha com curiosidade elevada');
    if (state.name==='perch') milestone('firstPerch','Primeiro pouso registrado','Uso de poleiro do cemitério');
    if (d.seconds>=3600) milestone('hourObserved','Uma hora de vida observada','Soma de tempo simulado com a página ativa');
    // Descriptive thresholds only, requiring observation time and no claim of neural learning.
    if(d.seconds>=1200 && !d.notices['areaLead']) {
      const top=topPlace(d);
      const free=Object.values(d.freeAreas).reduce((a,b)=>a+b,0);
      if(top && free>=900 && top[1]/free>=0.45) {
        d.notices['areaLead']=true;
        log('Concentração espacial observada',top[0]+': '+Math.round(100*top[1]/free)+'% do tempo livre registrado hoje');
      }
    }
    const dates=Object.keys(data.days).sort();
    const ix=dates.indexOf(dayKey(new Date()));
    const prior=ix>0?data.days[dates[ix-1]]:null;
    if(prior && prior.seconds>=1200 && d.seconds>=1200 && !d.notices['areaShift']){
      const a=topPlace(prior),b=topPlace(d);
      if(a && b && a[0]!==b[0]){
        d.notices['areaShift']=true;
        log('Mudança de local predominante',a[0]+' → '+b[0]+'; comparação descritiva entre dias');
      }
    }
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
    // Save live weights first; the previous automatic checkpoint can be up to 30 s old.
    document.getElementById('btn-save').click();
    if(document.getElementById('status-line')?.textContent==='Armazenamento local indisponível.'){
      alert('Armazenamento indisponível. Exportação cancelada para não recuperar dados antigos.');return;
    }
    persist();
    let checkpoint=null;
    try {checkpoint=JSON.parse(localStorage.getItem(PET_KEY)||'null');} catch(_){}
    if(!checkpoint){alert('Checkpoint neural indisponível. O backup foi cancelado.');return;}
    download('devilpet-backup-'+dayKey(new Date())+'.json',
      JSON.stringify({format:'devilpet-backup-v1',createdAt:new Date().toISOString(),checkpoint:checkpoint,ethology:data},null,2),
      'application/json;charset=utf-8');
  }
  function csv() {
    const header=['data_iso','x','y','z','estado','guiado','energia','descanso','vinculo','arquitetura','local','poleiro'];
    const rows=data.samples.map(s=>header.map((_,i)=>String(s[i]??'').replace(/"/g,'""')).map(v=>'"'+v+'"').join(';'));
    download('devilpet-etologia-'+dayKey(new Date())+'.csv','\uFEFF'+[header.join(';'),...rows].join('\r\n'),'text/csv;charset=utf-8');
  }
  function render() {
    const d=today(), seconds=d.seconds;
    const focus=topPlace(d), totFree=Object.values(d.freeAreas).reduce((a,b)=>a+b,0);
    const ordered=rankings(d.perches);
    const place=ordered.length ? ordered[0][0]+' ('+
      Math.round(100*ordered[0][1]/Math.max(0.01,d.times.perch))+'% do tempo pousada)' :
      'Ainda sem pousos registrados';
    const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
    set('eth-total',showTime(seconds));
    set('eth-distance',d.distance.toFixed(1)+' unidades');
    set('eth-cells',d.cells.filter(x=>x>0).length+'/'+(GRID*GRID)+' áreas');
    set('eth-entropy',entropy(d.cells).toFixed(2)+' nats');
    set('eth-perch',place);
    set('eth-assisted',showTime(d.assistedSeconds));
    set('eth-actions',Object.entries(labels).map(([k,v])=>v+': '+showTime(d.times[k]||0)).join(' · '));
    set('eth-summary',summaryFor(d));
    set('eth-days',Object.keys(data.days).filter(k=>data.days[k].seconds>=30).length+' dias observados');
    const fill=(id,rows,emptyText)=>{
      const root=document.getElementById(id);if(!root)return;
      root.replaceChildren();
      if(!rows.length){const li=document.createElement('li');li.textContent=emptyText;root.appendChild(li);return;}
      rows.forEach(item=>{const li=document.createElement('li');li.textContent=item;root.appendChild(li);});
    };
    const places=rankings(d.freeAreas).slice(0,7).map(([name,secs])=>
      name+': '+showTime(secs)+' ('+Math.round(100*secs/Math.max(0.01,totFree))+'% do tempo livre)');
    fill('eth-places',places,'Aguardando observações sem comandos.');
    fill('eth-sleep-places',rankings(d.sleepAreas).slice(0,5).map(([name,secs])=>name+': '+showTime(secs)),
      'Ainda não há locais de sono registrados.');
    const latest=Object.keys(data.days).sort().reverse().slice(0,7);
    fill('eth-history',latest.map(date=>date+': '+summaryFor(data.days[date])),
      'O histórico começará quando a mosca se movimentar.');
    const markers=Object.values(data.milestones||{}).reverse().slice(0,8);
    fill('eth-milestones',markers.map(m=>new Date(m.time).toLocaleDateString('pt-BR')+' — '+m.title),
      'Os marcos aparecerão conforme acontecimentos forem observados.');
    fill('eth-events',data.events.slice(-12).reverse().map(x=>
      new Date(x.time).toLocaleString('pt-BR')+' — '+x.type+(x.detail?' · '+x.detail:'')),
      'Sem eventos registrados ainda.');
    // Heat map data is retained for future scientific plots, but the grid is hidden by user choice.
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
    '<div class="divider"></div>'+
    '<h3 style="font-size:14px">Diário de hoje</h3><p id="eth-summary" style="font-size:12px;line-height:1.7"></p>'+
    '<p id="eth-days" style="color:var(--muted);font-size:12px"></p>'+
    '<details open><summary>Locais preferidos sem comandos</summary><ol id="eth-places" style="font-size:12px;line-height:1.7;padding-left:20px"></ol></details>'+
    '<details><summary>Onde ela dorme</summary><ol id="eth-sleep-places" style="font-size:12px;line-height:1.7;padding-left:20px"></ol></details>'+
    '<details><summary>Últimos sete dias</summary><ul id="eth-history" style="font-size:12px;line-height:1.7;padding-left:20px"></ul></details>'+
    '<details><summary>Marcos da vida da diabinha</summary><ul id="eth-milestones" style="font-size:12px;line-height:1.7;padding-left:20px"></ul></details>'+
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
  // Passive classification only; caregiver commands never modify neural decisions.
  let caregiverUntil=0;
  window.DevilPetDiarySnapshot=()=>JSON.parse(JSON.stringify(data));
  // Caregiver interventions recorded distinctly from spontaneous behavior.
  [['btn-feed','Sangue oferecido'],['btn-ball','Bolinha lançada'],['btn-takeoff','Decolagem comandada'],
   ['btn-sleep','Sono controlado'],['btn-pos','PAM aplicado'],['btn-neg','PPL1 aplicado'],
   ['btn-save','Checkpoint salvo'],['btn-load','Checkpoint restaurado']]
   .forEach(([id,name])=>{
      const el=document.getElementById(id);
      if(el)el.addEventListener('click',e=>{
        if((id==='btn-save'||id==='btn-load')&&!e.isTrusted)return; // autosave is not caregiver behavior
        if(id!=='btn-save'&&id!=='btn-load')caregiverUntil=performance.now()+5000;
        log(name,'posição '+flyPos.x.toFixed(1)+','+flyPos.z.toFixed(1));
      },true);
   });
  // Keyboard shortcuts also count as caregiver interventions; only the diary is affected.
  window.addEventListener('keydown',e=>{
    const tag=document.activeElement?.tagName;
    if(e.repeat || tag==='INPUT' || tag==='TEXTAREA' || tag==='BUTTON')return;
    if(e.code==='Space' || e.key==='+' || e.key==='x' || e.key==='X' || e.key==='-'){
      caregiverUntil=performance.now()+5000;
      log((e.code==='Space'||e.key==='+')?'PAM aplicado pelo teclado':'PPL1 aplicado pelo teclado',
        'posição '+flyPos.x.toFixed(1)+','+flyPos.z.toFixed(1));
    }
  },true);
  const viewport=document.getElementById('viewport');
  if(viewport)viewport.addEventListener('pointerup',()=>{if(placeMode==='call'){
    caregiverUntil=performance.now()+5000;
    log('Chamado do cuidador','comando de movimento');
  }},false);

  let lastFrame=performance.now(),lastSample=0,lastSave=performance.now(),lastRender=0;
  let prevState=null,prevPerch=null,prevArea=null,prevDate=null;
  const oldStep=stepSimulation;
  stepSimulation=function(...args){
    const before={x:flyPos.x,y:flyPos.y,z:flyPos.z};
    const result=oldStep.apply(this,args);
    const now=performance.now();
    const dt=Math.max(0,Math.min(0.10,(now-lastFrame)/1000));
    lastFrame=now;
    const d=today(),state=classify(), assisted=!!(callTarget.active||flightBoostTimer>0||now<caregiverUntil);
    const date=dayKey(new Date()), area=areaAt(flyPos);
    if(date!==prevDate){prevArea=null;prevDate=date;}
    if(dt>0){
      d.seconds+=dt;
      d.times[state.name]=(d.times[state.name]||0)+dt;
      d.distance+=Math.hypot(flyPos.x-before.x,flyPos.y-before.y,flyPos.z-before.z);
      if(state.perch)d.perches[state.perch.label]=(d.perches[state.perch.label]||0)+dt;
      d.cells[gridIndex()]+=dt;
      d.areas[area]=(d.areas[area]||0)+dt;
      if(state.name==='sleep')d.sleepAreas[area]=(d.sleepAreas[area]||0)+dt;
      if(assisted)d.assistedSeconds+=dt;
      else d.freeAreas[area]=(d.freeAreas[area]||0)+dt;
      if(prevArea!==area){d.visits[area]=(d.visits[area]||0)+1;prevArea=area;}
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
        state.name,assisted?1:0,+pet.energy.toFixed(4),+pet.rest.toFixed(4),+pet.bond.toFixed(4),brain.tierKey,area,
        state.perch ? state.perch.label : '']);
      limit();
    }
    if(now-lastRender>5000){lastRender=now;observations(d,state);render();}
    if(now-lastSave>30000){lastSave=now;persist();}
    return result;
  };
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')persist();});
  window.addEventListener('pagehide',persist);
  render();persist();
})();
