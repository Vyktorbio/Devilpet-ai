//! Rust port of the simplified ORN / PN / KC associative circuit.
use crate::rng::Mulberry32;
use serde::{Deserialize, Serialize};

const ODORS: [[f64;8];4]=[
 [1.,.22,.12,.04,.05,.04,.08,.02],
 [.10,.90,.25,.06,.04,.08,.03,.05],
 [.08,.14,.92,.38,.08,.04,.10,.03],
 [.18,.07,.20,.94,.42,.15,.05,.09],
];
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct FruitPatch { pub x:f64,pub z:f64,pub odor:f64,pub food:f64 }
#[derive(Debug, Clone, Copy)]
pub struct OdorSignal { pub food:f64 }
#[derive(Debug, Clone, Copy)]
pub struct PetVitals { pub energy:f64,pub rest:f64,pub curiosity:f64 }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OdorDecision {
 pub activity:String,pub target:i32,
 #[serde(rename="odorValue")] pub odor_value:f64,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OdorSnapshot {
 pub weights:Vec<f64>,pub spatial:Vec<f64>,pub visits:Vec<u32>,
 pub rewards:u64,pub punishments:u64,pub steps:u64,pub rng:u32,
}
pub struct FlyNeuroEthology {
 pub rng:Mulberry32,pub orn:[f64;8],pub pn:[f64;8],pub kc:[f64;96],
 pub weights:Vec<f64>,pub spatial:[f64;4],pub visits:[u32;4],
 pub heading:f64,pub activity:&'static str,pub last_choice:i32,
 pub rewards:u64,pub punishments:u64,pub steps:u64,
 projection:[[usize;3];96],
}
impl FlyNeuroEthology {
 pub fn new(seed:u32)->Self {
  let projection=std::array::from_fn(|k|[k%8,(k*5+3)%8,(k*7+1)%8]);
  Self{rng:Mulberry32::new(seed),orn:[0.;8],pn:[0.;8],kc:[0.;96],
   weights:vec![0.;96*4*2],spatial:[0.;4],visits:[0;4],heading:0.,
   activity:"explorar",last_choice:-1,rewards:0,punishments:0,steps:0,projection}
 }
 pub fn sense(&mut self,fruits:&[FruitPatch;4],x:f64,z:f64) {
  self.orn.fill(0.);
  for i in 0..4 {
   let f=fruits[i];let d=((f.x-x).powi(2)+(f.z-z).powi(2)).sqrt();
   let concentration=f.odor*f.food/(1.+.085*d*d);
   for g in 0..8{self.orn[g]+=concentration*ODORS[i][g];}
  }
  for g in 0..8{
   let surround=(self.orn[(g+1)%8]+self.orn[(g+7)%8])*.16;
   self.pn[g]=(self.orn[g].tanh()-surround).max(0.);
  }
  for k in 0..96{
   let a=self.projection[k];let v=(self.pn[a[0]]+self.pn[a[1]]+self.pn[a[2]])/3.;
   self.kc[k]=if v>.22{((v-.22)*2.6).min(1.)}else{0.};
  }
 }
 pub fn odor_value(&self,i:usize)->f64{
  assert!(i<4,"odor index out of range");
  let mut sum=0.;let mut den=0.;let t=&ODORS[i];
  for k in 0..96{
   let p=self.projection[k];let act=(t[p[0]]+t[p[1]]+t[p[2]])/3.;
   if act<.18{continue;}
   let idx=(i*96+k)*2;
   sum+=act*(self.weights[idx]-self.weights[idx+1]);den+=act;
  }
  if den>0.{sum/den}else{0.}
 }
 pub fn choose(&mut self,sensory:&[OdorSignal;4],pet:PetVitals)->OdorDecision{
  self.steps+=1;
  let hunger=1.-pet.energy;let fatigue=1.-pet.rest;
  let best_odor=(0..4).map(|i|self.odor_value(i)).fold(f64::NEG_INFINITY,f64::max);
  let actions=[
   ("alimentar",.15+2.5*hunger+best_odor*.45),
   ("repousar",.1+2.1*fatigue),
   ("explorar",.4+pet.curiosity*.8),
   ("brincar",.10+pet.curiosity*.9),
  ];
  if self.steps==1||self.steps%90==0{
   let exps=actions.map(|a|(a.1*1.6).exp());
   let total=exps.iter().sum::<f64>();let mut r=self.rng.next_f64()*total;
   for i in 0..4{r-=exps[i];if r<=0.{self.activity=actions[i].0;break;}}
  }
  let mut scores=[f64::NEG_INFINITY;4];
  for i in 0..4 {
   if sensory[i].food<=.0005{continue;}
   scores[i]=sensory[i].food*(.35+2.*hunger)+self.odor_value(i)*1.5+self.spatial[i]*.08;
  }
  let mut best=-1;let mut best_score=f64::NEG_INFINITY;
  for i in 0..4{
   if scores[i]>best_score+1e-9{
    best=i as i32;best_score=scores[i];
   }else if scores[i].is_finite()&&(scores[i]-best_score).abs()<=1e-9&&self.rng.next_f64()<.5{
    best=i as i32;
   }
  }
  let previous=self.last_choice;
  if previous>=0 && scores[previous as usize].is_finite() &&
   scores[previous as usize]>=best_score-.12 && self.steps%120!=0 {best=previous;}
  self.last_choice=best;
  OdorDecision{activity:self.activity.to_owned(),target:best,
   odor_value:if best<0{0.}else{self.odor_value(best as usize)}}
 }
 pub fn reinforce(&mut self,index:usize,reward:f64) {
  if index>=4||!reward.is_finite(){return;}
  let t=&ODORS[index];let sign=if reward>0.{1.}else if reward<0.{-1.}else{0.};
  for k in 0..96{
   let p=self.projection[k];let act=(t[p[0]]+t[p[1]]+t[p[2]])/3.;
   if act<.18{continue;}
   let idx=(index*96+k)*2;let delta=(act*.016).min(.02)*sign;
   self.weights[idx]=(self.weights[idx]+delta).clamp(-1.,1.);
   self.weights[idx+1]=(self.weights[idx+1]-delta).clamp(-1.,1.);
  }
  self.spatial[index]=(self.spatial[index]+.09*sign).clamp(-1.,1.);
  if reward>0.{self.rewards+=1;}else{self.punishments+=1;}
 }
 pub fn rest(&mut self){
  for w in &mut self.weights{*w*=.999995;}
  for s in &mut self.spatial{*s*=.99999;}
 }
 pub fn snapshot(&self)->OdorSnapshot{
  OdorSnapshot{weights:self.weights.clone(),spatial:self.spatial.to_vec(),
   visits:self.visits.to_vec(),rewards:self.rewards,punishments:self.punishments,
   steps:self.steps,rng:self.rng.state()}
 }
 pub fn restore(&mut self,snap:&OdorSnapshot)->Result<(),&'static str>{
  if snap.weights.len()!=768||!snap.weights.iter().all(|v|v.is_finite()){return Err("invalid odor weights");}
  if snap.spatial.len()!=4||!snap.spatial.iter().all(|v|v.is_finite()){return Err("invalid spatial values");}
  if snap.visits.len()!=4{return Err("invalid visits");}
  self.weights.clone_from(&snap.weights);
  self.spatial.copy_from_slice(&snap.spatial);
  self.visits.copy_from_slice(&snap.visits);
  self.rewards=snap.rewards;self.punishments=snap.punishments;self.steps=snap.steps;
  self.rng.set_state(snap.rng);
  self.activity="explorar";self.last_choice=-1;self.heading=0.;
  Ok(())
 }
}
#[cfg(test)]
mod tests{
 use super::*;
 #[test]
 fn odor_memories_roundtrip(){
  let mut a=FlyNeuroEthology::new(47);
  a.reinforce(2,1.);
  assert!(a.weights.iter().any(|v|v.abs()>0.));
  assert_eq!(a.rewards,1);
  let snap=a.snapshot();let mut b=FlyNeuroEthology::new(47);
  b.restore(&snap).unwrap();assert_eq!(snap,b.snapshot());
 }
 #[test]
 fn deterministic_choices(){
  let fruit=[FruitPatch{x:0.,z:0.,odor:1.,food:1.};4];
  let mut a=FlyNeuroEthology::new(47);let mut b=FlyNeuroEthology::new(47);
  a.sense(&fruit,1.,1.);b.sense(&fruit,1.,1.);
  let sense=[OdorSignal{food:1.};4];let pet=PetVitals{energy:.5,rest:.8,curiosity:.6};
  for _ in 0..180 {
   let x=a.choose(&sense,pet);let y=b.choose(&sense,pet);
   assert_eq!(x.target,y.target);assert_eq!(x.activity,y.activity);
  }
 }
}
