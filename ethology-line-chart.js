/* DevilPet — gráfico de linhas unificado, observador passivo de amostras já registradas.
 * Não altera as decisões, sinapses, nem a física do bichinho.
 */
(() => {
  'use strict';
  const getData=window.DevilPetDiarySnapshot;
  const journal=document.getElementById('ethology-panel');
  if(typeof getData!=='function' || !journal)return;
  const series=[
    {id:'energy',name:'Energia',color:'#55d9a0',kind:'vital',value:s=>s[6]*100},
    {id:'rest',name:'Descanso',color:'#ad9ef7',kind:'vital',value:s=>s[7]*100},
    {id:'curiosity',name:'Curiosidade',color:'#7cdde8',kind:'vital',value:s=>s.length>=13?s[12]*100:null},
    {id:'bond',name:'Vínculo',color:'#f5a9cd',kind:'vital',value:s=>s[8]*100},
    {id:'altitude',name:'Altura relativa',color:'#f7ca73',kind:'vital',value:s=>s[2]/5.4*100},
    {id:'flight',name:'Voando',color:'#5eaffc',kind:'state',value:s=>s[4]==='fly'?100:0},
    {id:'perch',name:'Pousada',color:'#d7a9fe',kind:'state',value:s=>s[4]==='perch'?100:0},
    {id:'play',name:'Brincando',color:'#ff949b',kind:'state',value:s=>s[4]==='play'?100:0},
    {id:'sleep',name:'Dormindo',color:'#8f9fbd',kind:'state',value:s=>s[4]==='sleep'?100:0},
    {id:'feed',name:'Alimentando',color:'#fa9867',kind:'state',value:s=>s[4]==='feed'?100:0}
  ];
  const enabled=new Set(series.map(s=>s.id));
  const section=document.createElement('section');
  section.id='eth-line-section';
  section.style.cssText='margin:16px 0 14px';
  section.innerHTML=
    '<h3 style="font-size:14px;margin:0 0 6px">Gráfico de linhas — evolução da diabinha</h3>'+
    '<p style="font-size:11px;color:var(--muted);line-height:1.6;margin-bottom:9px">Todas as séries usam uma escala de 0 a 100%. Altura = porcentagem da altura máxima virtual; comportamentos = frequência no intervalo amostrado. Nenhum valor é inventado. Toque na legenda para mostrar ou ocultar uma linha.</p>'+
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">'+
      '<label for="eth-chart-range" style="font-size:12px">Período</label>'+
      '<select id="eth-chart-range" aria-label="Período do gráfico" style="font-size:12px;max-width:200px;padding:6px;border:1px solid var(--border);border-radius:8px;background:var(--panel-2);color:inherit">'+
        '<option value="all">Tudo registrado</option><option value="3600000">Última hora</option><option value="21600000">Últimas 6 horas</option>'+
      '</select>'+
    '</div>'+
    '<canvas id="eth-line-chart" width="900" height="280" role="img" aria-label="Gráfico de linhas do histórico da diabinha, com energia, descanso, curiosidade, vínculo, altitude e estados comportamentais" style="width:100%;height:270px;display:block;border:1px solid var(--border);border-radius:9px;background:#0d1320"></canvas>'+
    '<div id="eth-line-legend" style="display:flex;gap:5px 8px;flex-wrap:wrap;margin-top:9px"></div>'+
    '<p id="eth-chart-note" style="font-size:11px;line-height:1.55;color:var(--muted);margin-top:7px">Aguardando observações.</p>';
  const metrics=journal.querySelector('.metrics');
  if(metrics)metrics.insertAdjacentElement('afterend',section);
  else journal.prepend(section);
  const canvas=section.querySelector('#eth-line-chart');
  const period=section.querySelector('#eth-chart-range');
  const legend=section.querySelector('#eth-line-legend');
  const note=section.querySelector('#eth-chart-note');
  const formatTime=(ms,withDay=false)=>{
    const d=new Date(ms);
    if(!Number.isFinite(d.getTime()))return '';
    return (withDay?d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})+' ':'')+
      d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  };
  for(const s of series){
    const btn=document.createElement('button');
    btn.type='button';
    btn.setAttribute('aria-pressed','true');
    btn.style.cssText='display:inline-flex;align-items:center;gap:5px;border:1px solid var(--border);'+
      'border-radius:7px;padding:5px 7px;font-size:11px;background:transparent;color:inherit;cursor:pointer';
    const dot=document.createElement('span');
    dot.style.cssText='display:inline-block;width:13px;height:4px;border-radius:2px;background:'+s.color;
    const label=document.createElement('span');
    label.textContent=s.name;
    btn.append(dot,label);
    btn.addEventListener('click',()=>{
      if(enabled.has(s.id))enabled.delete(s.id);else enabled.add(s.id);
      btn.setAttribute('aria-pressed',String(enabled.has(s.id)));
      btn.style.opacity=enabled.has(s.id)?'1':'0.35';
      render();
    });
    legend.appendChild(btn);
  }
  // Aggregate only for display; raw records stay unchanged for calculations and exports.
  function compact(rows){
    if(!rows.length)return [];
    const batch=Math.max(1,Math.ceil(rows.length/700));
    const output=[];
    let current=null,lastTime=null,segment=0;
    function flush(){
      if(!current || !current.n)return;
      const values=current.values.map((sum,i)=>current.valid[i]?sum/current.valid[i]:null);
      output.push({t:current.sumTime/current.n,segment:current.segment,values});
      current=null;
    }
    for(const row of rows){
      const t=Date.parse(row[0]);
      if(!Number.isFinite(t))continue;
      if(lastTime!==null && (t-lastTime<0 || t-lastTime>6500)){
        flush();
        segment++;
      }
      if(current && current.n>=batch)flush();
      if(!current)current={sumTime:0,n:0,segment,values:series.map(()=>0),valid:series.map(()=>0)};
      current.sumTime+=t;current.n++;
      series.forEach((s,i)=>{
        const y=Number(s.value(row));
        if(s.value(row)!==null && Number.isFinite(y)){
          current.values[i]+=Math.max(0,Math.min(100,y));
          current.valid[i]++;
        }
      });
      lastTime=t;
    }
    flush();
    return output;
  }
  function render(){
    const rect=canvas.getBoundingClientRect();
    const width=Math.max(260,Math.round(rect.width||320));
    const height=270;
    const dpr=Math.min(2,window.devicePixelRatio||1);
    if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){
      canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    }
    const ctx=canvas.getContext('2d');if(!ctx)return;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,width,height);
    const left=45,right=width-13,top=22,bottom=height-34;
    ctx.font='11px system-ui,sans-serif';
    ctx.textBaseline='middle';
    ctx.lineWidth=1;
    for(let pct=0;pct<=100;pct+=25){
      const y=bottom-(pct/100)*(bottom-top);
      ctx.strokeStyle='rgba(160,173,198,.19)';
      ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();
      ctx.fillStyle='#a6b3ca';ctx.textAlign='right';ctx.fillText(pct+'%',left-7,y);
    }
    ctx.textAlign='left';ctx.fillStyle='#a6b3ca';
    ctx.fillText('0–100%',left,11);
    let rows=[];
    try{
      const d=getData();
      rows=Array.isArray(d?.samples)?d.samples:[];
    }catch(_){}
    const range=period.value==='all'?0:Number(period.value);
    if(range && rows.length){
      const newest=Date.parse(rows[rows.length-1][0]);
      rows=rows.filter(r=>Date.parse(r[0])>=newest-range);
    }
    const points=compact(rows);
    if(points.length<2){
      ctx.fillStyle='#b8c3d5';ctx.textAlign='center';
      ctx.fillText('O gráfico aparece após algumas observações.',(left+right)/2,(top+bottom)/2);
      note.textContent='Ainda não há registros suficientes. Deixe a diabinha se movimentar por alguns segundos.';
      return;
    }
    const min=points[0].t,max=points[points.length-1].t;
    const span=Math.max(1000,max-min);
    const xOf=p=>left+((p.t-min)/span)*(right-left);
    const yOf=y=>bottom-(y/100)*(bottom-top);
    const showDay=max-min>12*3600000;
    ctx.fillStyle='#a6b3ca';ctx.textBaseline='alphabetic';
    for(const fraction of [0,.5,1]){
      const stamp=min+fraction*(max-min);
      const x=left+fraction*(right-left);
      ctx.textAlign=fraction===0?'left':fraction===1?'right':'center';
      ctx.fillText(formatTime(stamp,showDay),x,height-9);
    }
    series.forEach((s,si)=>{
      if(!enabled.has(s.id))return;
      ctx.strokeStyle=s.color;
      ctx.lineWidth=s.kind==='state'?1.4:2;
      ctx.setLineDash(s.kind==='state'?[4,3]:[]);
      let prevSegment=null,started=false;
      ctx.beginPath();
      for(const p of points){
        const y=p.values[si];
        if(!Number.isFinite(y)){
          if(started){ctx.stroke();ctx.beginPath();}
          started=false;prevSegment=null;continue;
        }
        const x=xOf(p),py=yOf(y);
        if(!started||prevSegment!==p.segment){
          if(started){ctx.stroke();ctx.beginPath();}
          ctx.moveTo(x,py);started=true;
        }else{ctx.lineTo(x,py);}
        prevSegment=p.segment;
      }
      if(started)ctx.stroke();
    });
    ctx.setLineDash([]);
    const count=rows.length;
    const curiosityAvailable=rows.some(s=>s.length>=13);
    note.textContent=count+' amostras desde '+formatTime(min,showDay)+' até '+formatTime(max,showDay)+
      '. Linhas pontilhadas = estados de atividade. Pausas não são conectadas.'+
      (curiosityAvailable?'':' A curiosidade só aparece nos novos registros.');
  }
  period.addEventListener('change',render);
  window.addEventListener('resize',render);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')render();});
  setInterval(()=>{if(document.visibilityState==='visible')render();},6000);
  render();
})();