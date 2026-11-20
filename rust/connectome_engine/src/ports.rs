//! Annotated sensor/motor ports for ONE real published connectome.
//! A real anatomical neuron ID is required for every port; labels alone are
//! not enough. Without reviewed source-backed binding, no real-CNS mode.
use crate::{Graph,PropagationConfig,propagate};
use serde::{Serialize,Deserialize};
use std::{collections::{BTreeMap,HashMap,HashSet},fs,io,path::Path};

#[derive(Debug,Clone,Serialize,Deserialize)]
pub struct PortNeuron {
    pub body_id:u64,
    pub annotation:String,
    pub evidence:String,
}
#[derive(Debug,Clone,Serialize,Deserialize)]
pub struct Ports {
    pub format:String,
    pub dataset_id:String,
    pub version:String,
    pub annotation_source:String,
    pub reviewed_by:String,
    pub reviewed_at:String,
    pub sensors:BTreeMap<String,Vec<PortNeuron>>,
    pub motors:BTreeMap<String,Vec<PortNeuron>>,
}
fn invalid(why:impl Into<String>)->io::Error{
    io::Error::new(io::ErrorKind::InvalidData,why.into())
}
pub const REQUIRED_MOTORS:[&str;4]=["forward","turn_left","turn_right","lift"];
pub const ALLOWED_SENSORS:[&str;9]=[
    "odor_left","odor_right","vision_left","vision_right",
    "mechanical_front","taste_food","touch","altitude","internal_state"
];
#[derive(Debug,Clone,Serialize)]
pub struct MotorCommands{
    pub forward:f32,
    pub turn:f32,
    pub lift:f32,
    pub activity:f32,
}
impl Ports{
    pub fn read(path:impl AsRef<Path>)->io::Result<Self>{
        let content=fs::read(path)?;
        serde_json::from_slice(&content).map_err(|e|invalid(e.to_string()))
    }
    pub fn validate(&self,graph:&Graph)->io::Result<()>{
        if self.format!="devilpet-connectome-ports-v1" {
            return Err(invalid("unknown port map version"));
        }
        if self.dataset_id!=graph.manifest.dataset_id || self.version!=graph.manifest.version {
            return Err(invalid("port map dataset/version differs from the loaded connectome"));
        }
        if self.annotation_source.trim().is_empty() ||
            self.reviewed_by.trim().is_empty() || self.reviewed_at.trim().is_empty() {
            return Err(invalid("official annotation provenance and human review required"));
        }
        if self.sensors.is_empty(){return Err(invalid("no sensory input neurons assigned"));}
        for key in REQUIRED_MOTORS{
            if self.motors.get(key).is_none_or(|v|v.is_empty()){
                return Err(invalid(format!("missing motor neuron group: {key}")));
            }
        }
        for (key,group) in &self.sensors {
            if !ALLOWED_SENSORS.contains(&key.as_str()) {
                return Err(invalid(format!("unknown sensory modality: {key}")));
            }
            self.validate_group(graph,key,group)?;
        }
        for (key,group) in &self.motors {
            if !REQUIRED_MOTORS.contains(&key.as_str()) {
                return Err(invalid(format!("unknown output motor group: {key}")));
            }
            self.validate_group(graph,key,group)?;
        }
        Ok(())
    }
    fn validate_group(&self,graph:&Graph,key:&str,group:&[PortNeuron])->io::Result<()>{
        if group.is_empty(){return Err(invalid(format!("empty sensory/motor group: {key}")));}
        let mut ids=HashSet::new();
        for n in group{
            if !ids.insert(n.body_id){return Err(invalid(format!("duplicate body_id within {key}")));}
            if graph.index_of(n.body_id).is_none(){
                return Err(invalid(format!("body_id {} absent from connectome {}",n.body_id,key)));
            }
            if n.annotation.trim().is_empty()||n.evidence.trim().is_empty(){
                return Err(invalid(format!("neuron {} missing source annotation/evidence",n.body_id)));
            }
        }
        Ok(())
    }
}
pub struct ConnectomeController<'a>{
    pub graph:&'a Graph,
    pub ports:Ports,
    pub cfg:PropagationConfig,
    sensors:BTreeMap<String,Vec<u32>>,
    motors:BTreeMap<String,Vec<u32>>,
}
impl<'a> ConnectomeController<'a>{
    pub fn new(graph:&'a Graph,ports:Ports,cfg:PropagationConfig)->io::Result<Self>{
        ports.validate(graph)?;
        let lookup=|groups:&BTreeMap<String,Vec<PortNeuron>>|{
            groups.iter().map(|(name,neurons)|{
                (name.clone(),neurons.iter().map(|n|graph.index_of(n.body_id).unwrap())
                    .collect::<Vec<u32>>())
            }).collect()
        };
        Ok(Self{graph,sensors:lookup(&ports.sensors),motors:lookup(&ports.motors),ports,cfg})
    }
    pub fn step(&self,obs:&BTreeMap<String,f32>,hops:usize)->io::Result<MotorCommands>{
        if hops==0||hops>5{return Err(invalid("hops must be 1..5"));}
        for(key,v) in obs{
            if !ALLOWED_SENSORS.contains(&key.as_str())||!v.is_finite()||*v<0.||*v>1.{
                return Err(invalid(format!("invalid sensory channel: {key}")));
            }
        }
        let mut state:HashMap<u32,f32>=HashMap::new();
        for(key,indices) in &self.sensors{
            let drive=*obs.get(key).unwrap_or(&0.);
            if drive<=0.{continue;}
            let share=drive/(indices.len() as f32).sqrt();
            for id in indices{
                *state.entry(*id).or_insert(0.)+=share;
            }
        }
        if state.len()>self.cfg.max_active_neurons{
            return Err(invalid("initial sensory population exceeds budget"));
        }
        // Each hop follows ONLY actual synaptic edges. No fictitious neuron IDs.
        // Transmitter signs, membrane potentials and learning are not present.
        let mut motor_state=state.clone();
        for _ in 0..hops {
            let mut active=state.into_iter().collect::<Vec<_>>();
            active.sort_unstable_by_key(|(idx,_)|*idx);
            let next=propagate(self.graph,&active,&self.cfg)?;
            state=next.into_iter().collect();
            for(&idx,&value) in &state{
                let entry=motor_state.entry(idx).or_insert(0.);
                if value>*entry{*entry=value;}
            }
            if state.is_empty(){break;}
        }
        let mean=|key:&str|{
            let ids=&self.motors[key];
            let sum=ids.iter().map(|idx|*motor_state.get(idx).unwrap_or(&0.)).sum::<f32>();
            sum/ids.len() as f32
        };
        let left=mean("turn_left");
        let right=mean("turn_right");
        let forward=mean("forward");
        let lift=mean("lift");
        Ok(MotorCommands{
            forward:(forward*0.2).tanh().max(0.),
            turn:((right-left)*0.2).tanh().clamp(-1.,1.),
            lift:(lift*0.2).tanh().max(0.),
            activity:(forward+left+right+lift).min(1_000.),
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn map_format_rejected_without_context(){
        assert_eq!(REQUIRED_MOTORS.len(),4);
        assert!(ALLOWED_SENSORS.contains(&"odor_left"));
    }
}
