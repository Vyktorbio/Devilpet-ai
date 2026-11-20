/* DevilPet neural engine — geometry-free, receives sensory values only.
 * Neuron/plasticity code moved verbatim from index.html; version 2026-11-19.
 */
const TIERS = {
  drosophila: { name: 'Drosophila',    nKC: 48,   nMBON: 2, fanIn: 4, aplGain: 0.35, recGain: 0.05 },
  expanded:   { name: 'Expandido',     nKC: 160,  nMBON: 4, fanIn: 3, aplGain: 0.55, recGain: 0.14 },
  bee:        { name: 'Abelha-Scale',  nKC: 420,  nMBON: 6, fanIn: 3, aplGain: 0.72, recGain: 0.24 },
  super:      { name: 'Super-Colônia', nKC: 1000, nMBON: 8, fanIn: 3, aplGain: 0.84, recGain: 0.36 }
};

function createRng(seed) {
  let s = seed >>> 0;
  return {
    next() {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    getState() { return s; },
    setState(v) { s = v >>> 0; }
  };
}

class ArchitecturalFlyBrain {
  constructor(tierKey = 'drosophila', seed = 42) {
    this.tierKey = tierKey;
    this.cfg = TIERS[tierKey];
    this.rng = createRng(seed);

    this.nSens = 30;
    this.nKC = this.cfg.nKC;
    this.nMBON = this.cfg.nMBON;
    this.nDN = 12;
    this.nTotal = this.nSens + this.nKC + this.nMBON + this.nDN;

    this.dt = 0.25;
    this.ev = Math.exp(-this.dt / 20.0);
    this.ee = Math.exp(-this.dt / 250.0);
    this.es = Math.exp(-this.dt / 18000.0);
    this.tick = 0;

    // Sparse expansion Sensory -> KC (5 cue channels: Cyan=0, Amber=1, Red=2, Ball=3, Aerial Sky=4)
    this.kcPre = [];
    this.kcCueTag = new Int8Array(this.nKC);
    for (let k = 0; k < this.nKC; k++) {
      const group = k % 5;
      this.kcCueTag[k] = group;
      const base = group * 6;
      const inputs = [];
      for (let f = 0; f < this.cfg.fanIn; f++) {
        const src = (f === 0 || this.rng.next() < 0.85)
          ? base + Math.floor(this.rng.next() * 6)
          : Math.floor(this.rng.next() * 30);
        inputs.push(src);
      }
      this.kcPre.push(inputs);
    }

    this.nPlastic = this.nKC * 2;
    this.shortW = new Float64Array(this.nPlastic);
    this.longW = new Float64Array(this.nPlastic);
    this.elig = new Float64Array(this.nPlastic);
    this.kcV = new Float64Array(this.nKC);
    this.mbonRate = new Float64Array(5); // Cyan, Amber, Red, Ball, Sky
    this.workingMem = new Float64Array(5); // Recurrent MBON->KC persistence
    this.lastActiveKC = 0;
  }

  getFactor(idx) {
    return Math.min(3.0, Math.max(0.1, 1.0 + this.shortW[idx] + this.longW[idx]));
  }

  stepWindow(cueInputs, modulation, consolidate, learn, durationMs = 15.0) {
    const steps = Math.round(durationMs / this.dt);
    let activeKCSum = 0;
    const mbonApproach = [0, 0, 0, 0, 0];
    const mbonAvoid = [0, 0, 0, 0, 0];
    let dnSpikes = 0;

    const cArr = [cueInputs.cyan, cueInputs.amber, cueInputs.red, cueInputs.ball, cueInputs.sky];
    const sensProb = new Float64Array(this.nSens);
    for (let g = 0; g < 5; g++) {
      // Recurrent working memory keeps recent context slightly active in higher tiers
      this.workingMem[g] = this.workingMem[g] * 0.92 + cArr[g] * 0.08;
      const effCue = Math.min(1.0, cArr[g] + this.cfg.recGain * this.workingMem[g]);
      const p = effCue * 0.14;
      for (let i = 0; i < 6; i++) sensProb[g * 6 + i] = p;
    }

    const consFrac = consolidate > 0 ? -Math.expm1(-consolidate * this.dt / 550.0) : 0;
    const lr = 0.42;

    for (let s = 0; s < steps; s++) {
      const sensSpk = new Uint8Array(this.nSens);
      for (let i = 0; i < this.nSens; i++) {
        if (this.rng.next() < sensProb[i]) sensSpk[i] = 1;
      }

      let kcSumV = 0;
      for (let k = 0; k < this.nKC; k++) {
        let inp = 0;
        const pres = this.kcPre[k];
        for (let f = 0; f < pres.length; f++) inp += sensSpk[pres[f]] * 3.8;
        this.kcV[k] = this.ev * this.kcV[k] + inp + (this.rng.next() - 0.5) * 0.22;
        kcSumV += Math.max(0, this.kcV[k]);
      }

      const aplInh = this.cfg.aplGain * (kcSumV / this.nKC);
      let firedCount = 0;

      for (let k = 0; k < this.nKC; k++) {
        const netV = this.kcV[k] - aplInh;
        const cue = this.kcCueTag[k];
        const eApp = k * 2;
        const eAvd = k * 2 + 1;

        this.elig[eApp] *= this.ee;
        this.elig[eAvd] *= this.ee;

        if (netV > 2.55) {
          this.kcV[k] = 0;
          firedCount++;
          const fApp = this.getFactor(eApp);
          const fAvd = this.getFactor(eAvd);
          mbonApproach[cue] += fApp;
          mbonAvoid[cue] += fAvd;
          this.elig[eApp] = Math.min(1.0, this.elig[eApp] + 0.65);
          this.elig[eAvd] = Math.min(1.0, this.elig[eAvd] + 0.65);
        }

        this.shortW[eApp] *= this.es;
        this.shortW[eAvd] *= this.es;

        if (learn && modulation !== 0) {
          const delta = lr * modulation * this.elig[eApp] * (this.dt / 250.0);
          this.shortW[eApp] = Math.min(2.0 - this.longW[eApp], Math.max(-0.9 - this.longW[eApp], this.shortW[eApp] + delta));
          this.shortW[eAvd] = Math.min(2.0 - this.longW[eAvd], Math.max(-0.9 - this.longW[eAvd], this.shortW[eAvd] - delta));
        }

        if (consFrac > 0) {
          const trA = this.shortW[eApp] * consFrac;
          this.longW[eApp] += trA;
          this.shortW[eApp] -= trA;
          const trB = this.shortW[eAvd] * consFrac;
          this.longW[eAvd] += trB;
          this.shortW[eAvd] -= trB;
        }
      }
      activeKCSum += firedCount;
      this.tick++;
    }

    const norm = Math.max(1, (this.nKC / 5) * 0.45);
    for (let g = 0; g < 5; g++) {
      this.mbonRate[g] = (mbonApproach[g] - mbonAvoid[g]) / norm;
      dnSpikes += Math.round((mbonApproach[g] + mbonAvoid[g]) * 0.22);
    }

    this.lastActiveKC = activeKCSum / Math.max(1, steps);
    return {
      mbonApproach,
      mbonAvoid,
      dnSpikes,
      sparsityPct: Math.min(100, (1 - this.lastActiveKC / this.nKC) * 100)
    };
  }

  telemetry() {
    let maxElig = 0, sumShort = 0, sumLong = 0;
    let cApp = 0, cN = 0, aApp = 0, aN = 0, rApp = 0, rAvd = 0, rN = 0, sApp = 0, sN = 0;
    for (let k = 0; k < this.nKC; k++) {
      const eApp = k * 2;
      const eAvd = k * 2 + 1;
      if (this.elig[eApp] > maxElig) maxElig = this.elig[eApp];
      sumShort += Math.abs(this.shortW[eApp]) + Math.abs(this.shortW[eAvd]);
      sumLong += Math.abs(this.longW[eApp]) + Math.abs(this.longW[eAvd]);
      const tag = this.kcCueTag[k];
      if (tag === 0) { cApp += this.getFactor(eApp); cN++; }
      else if (tag === 1) { aApp += this.getFactor(eApp); aN++; }
      else if (tag === 2) { rApp += this.getFactor(eApp); rAvd += this.getFactor(eAvd); rN++; }
      else if (tag === 4) { sApp += this.getFactor(eApp); sN++; }
    }
    return {
      maxElig,
      meanShort: sumShort / Math.max(1, this.nPlastic),
      meanLong: sumLong / Math.max(1, this.nPlastic),
      prefCyan: cApp / Math.max(1, cN),
      prefAmber: aApp / Math.max(1, aN),
      prefRed: rApp / Math.max(1, rN),
      avoidRed: rAvd / Math.max(1, rN),
      prefSky: sApp / Math.max(1, sN)
    };
  }
}

class FlyNeuroEthology {
  constructor(seed=47) {
    this.rng=createRng(seed); this.nOdors=4; this.nGlomeruli=8; this.nKCs=96;
    this.orn=new Float64Array(8);this.pn=new Float64Array(8);
    this.kc=new Float64Array(96);this.weights=new Float64Array(96*4*2);
    this.eligibility=new Float64Array(96*4);
    this.memory=new Float64Array(4);this.spatial=new Float64Array(4);
    this.visits=new Uint32Array(4);this.heading=0;this.activity='explorar';
    this.lastChoice=-1;this.rewards=0;this.punishments=0;this.steps=0;
    this.compartments=['gamma1-PPL1','gamma5-PAM','beta2-PAM','alpha2-PPL1'];
    this.odorTemplates=[[1,.22,.12,.04,.05,.04,.08,.02],[.10,.90,.25,.06,.04,.08,.03,.05],
      [.08,.14,.92,.38,.08,.04,.10,.03],[.18,.07,.20,.94,.42,.15,.05,.09]];
    this.projection=Array.from({length:96},(_,k)=>[k%8,(k*5+3)%8,(k*7+1)%8]);
  }
  sense(fruits,pos) {
    this.orn.fill(0);
    for(let i=0;i<4;i++){
      const f=fruits[i],d=Math.hypot(f.x-pos.x,f.z-pos.z);
      const concentration=f.odor*f.food/(1+0.085*d*d);
      for(let g=0;g<8;g++)this.orn[g]+=concentration*this.odorTemplates[i][g];
    }
    for(let g=0;g<8;g++){
      const surround=(this.orn[(g+1)%8]+this.orn[(g+7)%8])*0.16;
      this.pn[g]=Math.max(0,Math.tanh(this.orn[g])-surround);
    }
    for(let k=0;k<96;k++){
      const a=this.projection[k],v=(this.pn[a[0]]+this.pn[a[1]]+this.pn[a[2]])/3;
      this.kc[k]=v>0.22?Math.min(1,(v-0.22)*2.6):0;
    }
  }
  odorValue(i) {
    let sum=0,denom=0;
    const t=this.odorTemplates[i];
    for(let k=0;k<96;k++){
      const p=this.projection[k],act=(t[p[0]]+t[p[1]]+t[p[2]])/3;
      if(act<0.18)continue;
      const idx=(i*96+k)*2;
      sum+=act*(this.weights[idx]-this.weights[idx+1]);denom+=act;
    }
    return denom?sum/denom:0;
  }
  choose(sensory,pet) {
    this.steps++;
    const hunger=1-pet.energy,fatigue=1-pet.rest;
    const actions=[
      {name:'alimentar',score:0.15+2.5*hunger+Math.max(...sensory.map((v,i)=>this.odorValue(i)))*0.45},
      {name:'repousar',score:0.1+2.1*fatigue},
      {name:'explorar',score:0.4+pet.curiosity*0.8},
      {name:'brincar',score:0.10+pet.curiosity*0.9}
    ];
    if(this.steps===1||this.steps%90===0){
      const exps=actions.map(a=>Math.exp(a.score*1.6)),total=exps.reduce((a,b)=>a+b,0);
      let r=this.rng.next()*total;
      for(let i=0;i<actions.length;i++){r-=exps[i];if(r<=0){this.activity=actions[i].name;break;}}
    }
    const scores=sensory.map((v,i)=>{
      if(v.food<=0.0005)return -Infinity;
      return v.food*(0.35+2*hunger)+this.odorValue(i)*1.5+
        this.spatial[i]*0.08;
    });
    let best=-1,bestScore=-Infinity;
    for(let i=0;i<scores.length;i++){
      if(scores[i]>bestScore+1e-9){best=i;bestScore=scores[i];}
      else if(Number.isFinite(scores[i])&&Math.abs(scores[i]-bestScore)<=1e-9&&this.rng.next()<0.5)best=i;
    }
    const previous=this.lastChoice;
    if(previous>=0&&Number.isFinite(scores[previous])&&scores[previous]>=bestScore-0.12&&this.steps%120!==0)best=previous;
    this.lastChoice=best;
    return {activity:this.activity,target:best,odorValue:best<0?0:this.odorValue(best)};
  }
  reinforce(i,reward) {
    if(i<0||i>=4||!Number.isFinite(reward))return;
    const t=this.odorTemplates[i];
    for(let k=0;k<96;k++){
      const p=this.projection[k],act=(t[p[0]]+t[p[1]]+t[p[2]])/3;
      if(act<0.18)continue;
      const idx=(i*96+k)*2;
      // Simplified compartment-specific DAN plasticity (not connectome exact).
      const delta=Math.min(0.02,act*0.016)*Math.sign(reward);
      this.weights[idx]=Math.max(-1,Math.min(1,this.weights[idx]+delta));
      this.weights[idx+1]=Math.max(-1,Math.min(1,this.weights[idx+1]-delta));
    }
    this.spatial[i]=Math.max(-1,Math.min(1,this.spatial[i]+0.09*Math.sign(reward)));
    if(reward>0)this.rewards++;else this.punishments++;
  }
  rest() {
    for(let i=0;i<this.weights.length;i++)this.weights[i]*=0.999995;
    for(let i=0;i<4;i++)this.spatial[i]*=0.99999;
  }
  snapshot(){return {weights:Array.from(this.weights),spatial:Array.from(this.spatial),visits:Array.from(this.visits),rewards:this.rewards,punishments:this.punishments,steps:this.steps,rng:this.rng.getState()};}
  restore(d){if(!d)return;if(d.weights?.length===this.weights.length)this.weights.set(d.weights);if(d.spatial?.length===4)this.spatial.set(d.spatial);if(d.visits?.length===4)this.visits.set(d.visits);this.rewards=d.rewards||0;this.punishments=d.punishments||0;this.steps=d.steps||0;if(Number.isInteger(d.rng))this.rng.setState(d.rng);}
}
