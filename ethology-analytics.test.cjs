/* Execute: node ethology-analytics.test.cjs
 * Nenhum estado do pet ou conexão de rede é acessado.
 */
const assert=require('node:assert/strict');
const {transitions,msd,dailyTrend}=require('./ethology-analytics.js');
const approx=(v,expected)=>assert.ok(Math.abs(v-expected)<1e-9,`${v} != ${expected}`);
const m=transitions({'fly>perch':3,'fly>ground':1,'perch>fly':2,'fly>fly':2,'invalid':10});
assert.equal(m.n,8);
const f=m.states.indexOf('fly'),p=m.states.indexOf('perch'),g=m.states.indexOf('ground');
approx(m.probabilities[f][p],.5);
approx(m.probabilities[f][g],1/6);
approx(m.probabilities[f][f],1/3);
assert.equal(m.probabilities[p][f],1);
assert.equal(m.probabilities[g][f],null);
assert.equal(transitions({}).n,0);
const stamp=(sec)=>new Date(2026,10,19,12,0,sec).toISOString();
const moving=[0,2,4,6,8,10,12,14,16,18].map((s,i)=>[stamp(s),i,0,0,'fly',0]);
const curve=msd(moving,'2026-11-19',[1,2,4]);
assert.deepEqual(curve.map(c=>c.pairs),[9,8,6]);
approx(curve[0].mean,1);approx(curve[1].mean,4);approx(curve[2].mean,16);
approx(curve[1].lagSeconds,4);
const stationary=msd(moving.map(s=>[s[0],0,0,0]),'2026-11-19',[1]);
assert.equal(stationary[0].mean,0);
const withGap=[...moving.slice(0,3),[stamp(40),100,0,0,'fly',0], [stamp(42),101,0,0,'fly',0]];
const gap=msd(withGap,'2026-11-19',[1,2]);
assert.deepEqual(gap.map(c=>c.pairs),[3,1]);
assert.equal(msd([], '2026-11-19')[0].mean,null);
const d=dailyTrend({'2026-11-17':{seconds:100,distance:5,times:{fly:60}},
  '2026-11-19':{seconds:0,distance:0,times:{}}},7);
approx(d[0].flyFraction,.6);
assert.equal(d[1].flyFraction,null);
console.log('OK: Markov, lacunas temporais, MSD e histórico diário.');