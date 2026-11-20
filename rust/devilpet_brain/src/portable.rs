//! Portable genotype plus learned memory, separated by design.
//!
//! A child inherits only immutable genotype settings, not parents' synaptic
//! weights. Breeding trained minds by averaging weights is not genetics.
//! Circadian scheduling uses the local hour supplied by the host application;
//! it never advances simulation time or sleeps automatically in this library.
use crate::{
    odor::{FlyNeuroEthology, OdorSnapshot},
    rng::Mulberry32,
    sparse::{ArchitecturalFlyBrain, FullSnapshot, JsCheckpoint, Tier},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const FORMAT: &str = "devilpet-portable-v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CircadianProfile {
    /// Informational IANA timezone name, interpreted by the host (not by this crate).
    pub timezone: String,
    pub sleep_hour: u8,
    pub wake_hour: u8,
}
impl CircadianProfile {
    /// True if the local clock falls in the scheduled rest window.
    /// A 22→07 schedule covers 22:00..23:59 and 00:00..06:59.
    /// Identical hours are rejected as ambiguous (not treated as a full day).
    pub fn is_night(&self, hour: u8) -> Result<bool, &'static str> {
        if self.sleep_hour >= 24 || self.wake_hour >= 24 || hour >= 24 ||
            self.sleep_hour == self.wake_hour {
            return Err("hours must be 0..23; sleep_hour and wake_hour must differ");
        }
        Ok(if self.sleep_hour < self.wake_hour {
            hour >= self.sleep_hour && hour < self.wake_hour
        } else {
            hour >= self.sleep_hour || hour < self.wake_hour
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Genome {
    pub lineage_id: String,
    pub parent_lineages: Vec<String>,
    pub tier: Tier,
    pub founder_seed: u32,
    /// Heritable circadian schedule: presentation/pet-state trait, not a
    /// parameter of the fixed neural plasticity model.
    pub circadian: CircadianProfile,
}
impl Genome {
    pub fn founder(lineage_id: impl Into<String>, tier: Tier, seed: u32,
                   timezone: impl Into<String>) -> Self {
        Self {lineage_id:lineage_id.into(), parent_lineages:vec![], tier, founder_seed:seed,
            circadian:CircadianProfile {timezone:timezone.into(),sleep_hour:22,wake_hour:7}}
    }
    pub fn offspring(a: &Self,b:&Self,new_lineage_id: impl Into<String>,seed:u32)->Self {
        let mut rng=Mulberry32::new(seed ^ a.founder_seed ^ b.founder_seed.rotate_left(13));
        let tier=if rng.next_f64() < .5 {a.tier} else {b.tier};
        // Inherit a valid complete circadian schedule from one parent.
        // A naive hour-by-hour crossover can accidentally produce sleep == wake.
        let circadian=if rng.next_f64() < .5 {
            a.circadian.clone()
        } else {
            b.circadian.clone()
        };
        let founder_seed=(rng.next_f64()*4_294_967_296.).floor() as u32;
        Self {
            lineage_id:new_lineage_id.into(), parent_lineages:vec![a.lineage_id.clone(),b.lineage_id.clone()],
            tier,founder_seed,circadian
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortableMind {
    /// Matches the browser's existing JS checkpoint layout, including shortW and longW.
    pub sparse: JsCheckpoint,
    /// Matches neuroEthology.snapshot().
    pub odor: OdorSnapshot,
    /// Optional Rust-only complete state for exact simulation resumption.
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub precise_state: Option<FullSnapshot>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortablePet {
    pub format: String,
    pub name: String,
    pub genome: Genome,
    pub mind: PortableMind,
}
impl PortablePet {
    pub fn new(name:impl Into<String>,genome:Genome)->Self{
        let sparse=ArchitecturalFlyBrain::new(genome.tier,genome.founder_seed);
        let odor=FlyNeuroEthology::new(47);
        Self{format:FORMAT.to_owned(),name:name.into(),genome,
            mind:PortableMind {sparse:sparse.js_checkpoint(),odor:odor.snapshot(),precise_state:None}}
    }
    pub fn from_rust_engines(name:impl Into<String>,genome:Genome,
                             sparse:&ArchitecturalFlyBrain,odor:&FlyNeuroEthology)->Result<Self,String> {
        let pet=Self{format:FORMAT.to_owned(),name:name.into(),genome,
            mind:PortableMind {sparse:sparse.js_checkpoint(),odor:odor.snapshot(),
                precise_state:Some(sparse.full_snapshot())}};
        pet.validate()?;Ok(pet)
    }
    /// Adapter from existing browser backup. Does not modify the browser's format.
    /// Because the old browser did not store elig/kcV, this import is weight-equivalent
    /// but does not guarantee exact continuation of the next spike.
    pub fn from_browser_backup(data:&Value,genome:Genome)->Result<Self,String> {
        if data.get("format").and_then(Value::as_str)!=Some("devilpet-backup-v1"){
            return Err("expected existing devilpet-backup-v1 export".into());
        }
        let cp=data.get("checkpoint").ok_or("missing checkpoint")?;
        let sparse:JsCheckpoint=serde_json::from_value(cp.clone()).map_err(|e|e.to_string())?;
        let odor:OdorSnapshot=serde_json::from_value(
            cp.get("neuroEthology").cloned().ok_or("missing neuroEthology")?)
            .map_err(|e|e.to_string())?;
        let name=cp.get("petName").and_then(Value::as_str).unwrap_or("Diabinha");
        let pet=Self {format:FORMAT.to_owned(),name:name.into(),genome,
            mind:PortableMind {sparse,odor,precise_state:None}};
        pet.validate()?;Ok(pet)
    }
    pub fn validate(&self)->Result<(),String>{
        if self.format!=FORMAT {return Err("unsupported format".into());}
        if self.genome.lineage_id.is_empty()||self.genome.lineage_id.len()>160 {
            return Err("invalid lineage id".into());
        }
        self.genome.circadian.is_night(0).map_err(|e|e.to_owned())?;
        if self.genome.tier!=self.mind.sparse.tier_key{return Err("genome/mind architecture mismatch".into());}
        let n=self.genome.tier.parameters().n_kc*2;
        if self.mind.sparse.short_w.len()!=n || self.mind.sparse.long_w.len()!=n ||
           !self.mind.sparse.short_w.iter().chain(&self.mind.sparse.long_w).all(|v|v.is_finite()){
            return Err("invalid KC/MBON weights".into());
        }
        if self.mind.odor.weights.len()!=768||self.mind.odor.spatial.len()!=4||
           self.mind.odor.visits.len()!=4 ||
           !self.mind.odor.weights.iter().chain(&self.mind.odor.spatial).all(|v|v.is_finite()){
            return Err("invalid odor/place memory".into());
        }
        if let Some(s)=&self.mind.precise_state {
            if s.checkpoint!=self.mind.sparse {return Err("full/legacy snapshot mismatch".into());}
        }
        Ok(())
    }
    /// Restores learned memories; the browser-weight import cannot restore
    /// membrane potentials that the browser never saved.
    pub fn load_engines(&self)->Result<(ArchitecturalFlyBrain,FlyNeuroEthology),String>{
        self.validate()?;
        let mut sparse=ArchitecturalFlyBrain::new(self.genome.tier,self.genome.founder_seed);
        if let Some(state)=&self.mind.precise_state{
            sparse.restore_full_snapshot(state).map_err(|e|e.to_string())?;
        }else{
            sparse.restore_js_checkpoint(&self.mind.sparse).map_err(|e|e.to_string())?;
        }
        let mut odor=FlyNeuroEthology::new(47);
        odor.restore(&self.mind.odor).map_err(|e|e.to_string())?;
        Ok((sparse,odor))
    }
    /// Create a genetically recombined *newborn*, with an untrained mind.
    pub fn child_from(a:&Self,b:&Self,lineage_id:impl Into<String>,seed:u32)->Self{
        Self::new("Filhote",Genome::offspring(&a.genome,&b.genome,lineage_id,seed))
    }
}

#[cfg(test)]
mod tests{
 use super::*;
 #[test]
 fn circadian_crosses_midnight(){
  let c=CircadianProfile{timezone:"America/Sao_Paulo".into(),sleep_hour:22,wake_hour:7};
  assert_eq!(c.is_night(23),Ok(true));
  assert_eq!(c.is_night(5),Ok(true));
  assert_eq!(c.is_night(12),Ok(false));
 }
 #[test]
 fn portable_mind_and_genome_roundtrip(){
  let g=Genome::founder("lineage-a",Tier::Bee,42,"America/Sao_Paulo");
  let pet=PortablePet::new("Diabinha",g);
  let s=serde_json::to_string(&pet).unwrap();
  let again:PortablePet=serde_json::from_str(&s).unwrap();
  again.validate().unwrap();
  let (brain,odor)=again.load_engines().unwrap();
  assert_eq!(brain.js_checkpoint(),again.mind.sparse);
  assert_eq!(odor.snapshot(),again.mind.odor);
 }
 #[test]
 fn breeding_does_not_transfer_learned_weights(){
  let g1=Genome::founder("a",Tier::Drosophila,42,"America/Sao_Paulo");
  let g2=Genome::founder("b",Tier::Bee,112,"America/Sao_Paulo");
  let a=PortablePet::new("A",g1);
  let mut b=PortablePet::new("B",g2);
  b.mind.sparse.long_w.fill(.5);
  let child=PortablePet::child_from(&a,&b,"filhote-1",5);
  assert!(child.mind.sparse.long_w.iter().all(|v|*v==0.));
  assert_eq!(child.genome.parent_lineages,vec!["a","b"]);
  child.validate().unwrap();
 }
}
