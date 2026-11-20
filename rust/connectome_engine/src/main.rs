use devilpet_connectome::{Graph,PropagationConfig,propagate};
use std::{env,error::Error};
fn main()->Result<(),Box<dyn Error>>{
 let a:Vec<String>=env::args().collect();
 if a.len()<3{
   eprintln!("Usage:\n  connectome-cli inspect GRAPH_DIR\n  connectome-cli neighbors GRAPH_DIR BODY_ID [TOP_N]\n  connectome-cli pulse GRAPH_DIR BODY_ID [STEPS]");
   return Ok(());
 }
 let graph=Graph::open(&a[2])?;
 match a[1].as_str(){
  "inspect"=>{
   println!("Dataset: {} ({})",graph.manifest.dataset_id,graph.manifest.version);
   println!("Source: {}",graph.manifest.source);
   println!("Nodes: {} | directed edge records: {}",graph.manifest.node_count,graph.manifest.edge_count);
   println!("Node scope: {}",graph.manifest.node_scope);
   println!("Semantics: {}. This is anatomical structure, not a validated brain simulation.",graph.manifest.edge_semantics);
  },
  "neighbors"=>{
   let id:u64=a.get(3).ok_or("missing BODY_ID")?.parse()?;
   let idx=graph.index_of(id).ok_or("neuron ID not present in this dataset/version")?;
   let limit:usize=a.get(4).map(|x|x.parse()).transpose()?.unwrap_or(20);
   let mut targets:Vec<_>=graph.outgoing(idx as usize).unwrap().collect();
   targets.sort_unstable_by(|a,b|b.1.total_cmp(&a.1));
   for (to,w) in targets.into_iter().take(limit) {
     println!("{} -> {}: {} synapses",id,graph.neuron_id(to as usize).unwrap(),w);
   }
  },
  "pulse"=>{
   let id:u64=a.get(3).ok_or("missing BODY_ID")?.parse()?;
   let idx=graph.index_of(id).ok_or("neuron ID not present in this dataset/version")?;
   let steps:usize=a.get(4).map(|x|x.parse()).transpose()?.unwrap_or(3);
   if steps>20{return Err("step limit exceeded".into());}
   let cfg=PropagationConfig::default();
   let mut active=vec![(idx,1.)];
   for step in 0..steps {
     active=propagate(&graph,&active,&cfg)?;
     println!("step {}: {} active nodes (descriptive unsigned signal propagation)",step+1,active.len());
     if active.is_empty(){break;}
   }
  },
  _=>return Err("unknown command".into())
 }
 Ok(())
}
