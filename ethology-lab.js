/* DevilPet — laboratório quantitativo passivo (Markov, MSD e tendência).
   Somente leitura de snapshots do diário. Não acessa o cérebro ou o controle motor. */
(() => {
  'use strict';
  const stats=window.DevilPetAnalytics;
  const snapshot=window.DevilPetDiarySnapshot;
  const journal=document.getElementById('ethology-panel');
  if(!stats || typeof snapshot!=='function' || !journal){
    console.warn('DevilPet: laboratório quantitativo indisponível.');
    return;
  }
  const labels={sleep:'Dormindo',feed:'Alimentando',play:'Brincando',perch:'Pousada',
    fly:'Voando',ground:'No solo'};
  const lab=document.createElement('details');
  lab.id='eth-quantitative';
  lab.style.marginTop='12px';
  lab.innerHTML=
    '<summary style="cursor:pointer;font-weight:600">Laboratório quantitativo: Markov e MSD</summary>'+
    '<p style="font-size:12px;color:var(--muted)">Análises descritivas do comportamento artificial. Não são evidência isolada de memória, aprendizagem ou consciência.</p>'+
    '<h3 style="font-size:13px">Cadeias de Markov: transição de estados</h3>'+
    '<p style="font-size:11px;color:var(--muted)">P(i→j) = N(i→j) / total de pares saindo de i. Inclui permanecer no mesmo estado. Observações a aproximadamente cada 2 segundos, excluindo períodos com comandos ativos e 5 segundos após intervenções.</p>'+
    '<p id="eth-tier-note" style="font-size:12px;color:var(--muted)"></p>'+ 
    '<p id="eth-markov-note" style="font-size:12px;color:var(--muted)"></p>'+
    '<ul id="eth-markov-list" style="font-size:12px;line-height:1.7;padding-left:20px"></ul>'+
    '<h3 style="font-size:13px">MSD: deslocamento quadrático médio</h3>'+
    '<p style="font-size:11px;color:var(--muted)">MSD(τ) = média de ||r(t+τ) − r(t)||², nas três dimensões. Resultados em unidades virtuais². Sem interpolar pausas ou períodos com o jogo fechado.</p>'+
    '<p style="font-size:11px;color:var(--muted)">Valores de MSD apresentados abaixo, sem um segundo gráfico.</p>'+
    '<ul id="eth-msd-list" style="font-size:12px;line-height:1.7;padding-left:20px"></ul>'+
    '<h3 style="font-size:13px">Comparação dos últimos sete dias</h3>'+
    '<ul id="eth-trend-list" style="font-size:12px;line-height:1.7;padding-left:20px"></ul>'+
    '<p style="font-size:11px;color:var(--muted)">Dados recentes: até 8.000 posições na memória local. Dias mais antigos podem ter apenas resumos. A distância é virtual, não uma medida física de Drosophila.</p>';
  journal.appendChild(lab);
  function putList(id,rows,emptyText){
    const ul=document.getElementById(id);if(!ul)return;
    ul.replaceChildren();
    const vals=rows.length?rows:[emptyText];
    for(const v of vals){const li=document.createElement('li');li.textContent=v;ul.appendChild(li);}
  }
  function sampleTransitions(rows,day){
    const counts={};
    for(let i=1;i<rows.length;i++){
      const a=rows[i-1],b=rows[i];
      if(!Array.isArray(a)||!Array.isArray(b))continue;
      const start=Date.parse(a[0]),end=Date.parse(b[0]),dt=(end-start)/1000;
      if(!Number.isFinite(dt)||dt<1||dt>5.5)continue;
      if(stats.localDay(new Date(start))!==day||stats.localDay(new Date(end))!==day)continue;
      if(Number(a[5])!==0||Number(b[5])!==0)continue;
      if(a[9]!==b[9])continue; // architecture changed during the observation
      if(!stats.STATES.includes(a[4])||!stats.STATES.includes(b[4]))continue;
      const key=a[4]+'>'+b[4];
      counts[key]=(counts[key]||0)+1;
    }
    return stats.transitions(counts);
  }
  function render(){
    let diary;
    try{diary=snapshot();}catch(e){return;}
    const day=stats.localDay(new Date());
    const samples=diary.samples||[];
    const currentTier=samples.length?samples[samples.length-1][9]:null;
    const tierSamples=currentTier?samples.filter(s=>s[9]===currentTier):samples;
    const tierNote=document.getElementById('eth-tier-note');
    if(tierNote)tierNote.textContent='Arquitetura observada: '+(currentTier||'aguardando dados')+
      '. Comparações por dia ainda incluem todas as arquiteturas utilizadas nesse dia.';
    const pairs=sampleTransitions(tierSamples,day);
    const note=document.getElementById('eth-markov-note');
    if(note)note.textContent=pairs.n<20
      ?'Amostra pequena: '+pairs.n+' pares elegíveis. Aguardando pelo menos 20 observações consecutivas.'
      :'Amostra descritiva: '+pairs.n+' pares de observações consecutivas sem comando.';
    const transitions=[];
    for(let i=0;i<pairs.states.length;i++){
      if(pairs.totals[i]<3)continue;
      const best=pairs.states.map((state,j)=>({state,n:pairs.counts[i][j],
        probability:pairs.probabilities[i][j]})).filter(v=>v.n>0)
        .sort((a,b)=>b.n-a.n).slice(0,2);
      best.forEach(v=>transitions.push(labels[pairs.states[i]]+' → '+labels[v.state]+
        ': '+(100*v.probability).toFixed(1)+'% ('+v.n+'/'+pairs.totals[i]+')'));
    }
    putList('eth-markov-list',transitions,'Ainda não há dados de transição suficientes.');
    const points=stats.msd(tierSamples,day,[1,2,4,8]).filter(v=>v.pairs>=3);
    putList('eth-msd-list',points.map(v=>'τ = '+v.lagSeconds.toFixed(1)+' s: MSD = '+
      v.mean.toFixed(2)+' unidades² (n = '+v.pairs+' pares)'),
      'São necessários pelo menos três pares contínuos de posições para cada intervalo.');
    const trend=stats.dailyTrend(diary.days||{},7).filter(v=>v.seconds>=30);
    putList('eth-trend-list',trend.map(v=>v.date+': '+(100*v.flyFraction).toFixed(1)+
      '% do tempo voando; '+v.distance.toFixed(1)+' unidades percorridas'),
      'Aguardando dias com pelo menos 30 segundos de observação.');
  }
  lab.addEventListener('toggle',()=>{if(lab.open)render();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&lab.open)render();});
  window.addEventListener('pagehide',()=>{if(lab.open)render();});
  setInterval(()=>{if(lab.open && document.visibilityState==='visible')render();},8000);
})();