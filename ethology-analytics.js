/* DevilPet — estatísticas passivas para etologia simulada.
 * Unidade espacial: unidades virtuais do cenário; nunca interpretar como centímetros.
 * Sem dependências da rede neural, movimento, aleatoriedade ou armazenamento.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  if(root) root.DevilPetAnalytics=api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';
  const STATES=['sleep','feed','play','perch','fly','ground'];
  function localDay(date){
    return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
  }
  function transitions(counters, states=STATES){
    const matrix=states.map(()=>states.map(()=>0));
    for(const [key, value] of Object.entries(counters||{})){
      const [from,to]=key.split('>');
      const i=states.indexOf(from),j=states.indexOf(to);
      if(i<0||j<0||i===j||!Number.isFinite(value)||value<=0)continue;
      matrix[i][j]+=value;
    }
    const totals=matrix.map(row=>row.reduce((a,b)=>a+b,0));
    const probabilities=matrix.map((row,i)=>row.map(v=>totals[i]?v/totals[i]:null));
    return {states:states.slice(),counts:matrix,probabilities,totals,n:totals.reduce((a,b)=>a+b,0)};
  }
  function msd(samples,day,lags=[1,2,4,8]){
    const rows=[];
    for(const s of samples||[]){
      if(!Array.isArray(s)||s.length<4)continue;
      const time=Date.parse(s[0]),x=Number(s[1]),y=Number(s[2]),z=Number(s[3]);
      if(!Number.isFinite(time)||!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z))continue;
      const d=localDay(new Date(time));
      if(day&&d!==day)continue;
      rows.push({time,x,y,z,day:d,segment:0});
    }
    rows.sort((a,b)=>a.time-b.time);
    let segment=0;
    for(let i=1;i<rows.length;i++){
      const gap=(rows[i].time-rows[i-1].time)/1000;
      if(gap<1 || gap>5.5 || rows[i].day!==rows[i-1].day)segment++;
      rows[i].segment=segment;
    }
    return lags.map(lag=>{
      let sum=0,tau=0,pairs=0;
      for(let i=lag;i<rows.length;i++){
        const a=rows[i-lag],b=rows[i];
        if(a.segment!==b.segment)continue;
        const dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z;
        sum+=dx*dx+dy*dy+dz*dz;
        tau+=(b.time-a.time)/1000;
        pairs++;
      }
      return {lagSamples:lag,lagSeconds:pairs?tau/pairs:null,mean:pairs?sum/pairs:null,pairs};
    });
  }
  function dailyTrend(days,lastN=7){
    return Object.keys(days||{}).sort().slice(-lastN).map(date=>{
      const d=days[date],seconds=Math.max(0,Number(d.seconds)||0);
      return {date,seconds,distance:Number(d.distance)||0,
        flyFraction:seconds?Math.min(1,Math.max(0,(Number(d.times?.fly)||0)/seconds)):null};
    });
  }
  return {STATES,transitions,msd,dailyTrend,localDay};
});