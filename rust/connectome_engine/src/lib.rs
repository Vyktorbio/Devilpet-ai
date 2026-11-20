//! Full *structural* Drosophila CNS graph engine.
//! Edges are real dataset-derived chemical synapse counts, not synthetic wiring.
//! Signal propagation here is an exploratory non-biophysical algorithm; a
//! connectivity graph alone does NOT encode neuronal dynamics, learning or mind.
use memmap2::{Mmap, MmapOptions};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap,fs::File,fs,io,path::Path};

#[derive(Debug,Clone,Serialize,Deserialize)]
pub struct Manifest {
    pub format: String,
    pub dataset_id: String,
    pub version: String,
    pub source: String,
    pub license: String,
    pub node_count: usize,
    pub edge_count: usize,
    pub node_scope: String,
    pub edge_semantics: String,
    #[serde(default)]
    pub processing: String,
}
impl Manifest {
    pub fn validate(&self)->io::Result<()>{
        if self.format!="devilpet-connectome-csr-v1" {return Err(bad("unsupported CSR format"));}
        if self.dataset_id.is_empty()||self.source.is_empty()||self.version.is_empty()
          ||self.license.is_empty() {return Err(bad("missing source provenance"));}
        if self.edge_semantics!="synapse_count" {return Err(bad("unknown edge semantics"));}
        Ok(())
    }
}
fn bad(message:&str)->io::Error{io::Error::new(io::ErrorKind::InvalidData,message)}
fn map_file(path:&Path,expected_bytes:usize)->io::Result<Option<Mmap>>{
    let f=File::open(path)?;
    if f.metadata()?.len()!=expected_bytes as u64{return Err(bad("file size differs from manifest"));}
    if expected_bytes==0{return Ok(None);}
    // Read-only OS memory mapping. No raw pointer arithmetic or unchecked casts.
    let map=unsafe {MmapOptions::new().map(&f)?};
    Ok(Some(map))
}
fn slice(map:&Option<Mmap>)->&[u8]{map.as_ref().map(|x|x.as_ref()).unwrap_or(&[])}
fn u64_at(bytes:&[u8],i:usize)->u64{
    let from=i*8;u64::from_le_bytes(bytes[from..from+8].try_into().unwrap())
}
fn u32_at(bytes:&[u8],i:usize)->u32{
    let from=i*4;u32::from_le_bytes(bytes[from..from+4].try_into().unwrap())
}
fn f32_at(bytes:&[u8],i:usize)->f32{
    f32::from_bits(u32_at(bytes,i))
}
/// Memory-mapped directed CSR adjacency, with original neuronal body IDs.
/// Binary edges: every released edge retained, no arbitrary thresholding.
pub struct Graph {
    pub manifest: Manifest,
    nodes:Option<Mmap>,
    offsets:Option<Mmap>,
    targets:Option<Mmap>,
    weights:Option<Mmap>,
}
impl Graph {
    pub fn open(dir:impl AsRef<Path>)->io::Result<Self>{
        let dir=dir.as_ref();
        let manifest:Manifest=serde_json::from_slice(&fs::read(dir.join("manifest.json"))?)?;
        manifest.validate()?;
        if manifest.node_count>=u32::MAX as usize {return Err(bad("more nodes than u32 index space"));}
        let n=manifest.node_count;
        let m=manifest.edge_count;
        let nodes=map_file(&dir.join("nodes.u64"),n.checked_mul(8).ok_or_else(||bad("node size overflow"))?)?;
        let offsets=map_file(&dir.join("offsets.u64"),(n+1).checked_mul(8).ok_or_else(||bad("offset overflow"))?)?;
        let targets=map_file(&dir.join("targets.u32"),m.checked_mul(4).ok_or_else(||bad("target overflow"))?)?;
        let weights=map_file(&dir.join("weights.f32"),m.checked_mul(4).ok_or_else(||bad("weight overflow"))?)?;
        let graph=Self{manifest,nodes,offsets,targets,weights};
        graph.validate()?;
        Ok(graph)
    }
    pub fn neuron_id(&self,index:usize)->Option<u64>{
        if index>=self.manifest.node_count {None}else{Some(u64_at(slice(&self.nodes),index))}
    }
    pub fn index_of(&self,body_id:u64)->Option<u32>{
        let mut lo=0usize;let mut hi=self.manifest.node_count;
        let nodes=slice(&self.nodes);
        while lo<hi {
            let mid=lo+(hi-lo)/2;
            if u64_at(nodes,mid)<body_id{lo=mid+1}else{hi=mid}
        }
        if lo<self.manifest.node_count && u64_at(nodes,lo)==body_id{Some(lo as u32)}else{None}
    }
    pub fn degree(&self,index:usize)->Option<usize>{
        if index>=self.manifest.node_count{return None;}
        let o=slice(&self.offsets);
        Some((u64_at(o,index+1)-u64_at(o,index))as usize)
    }
    pub fn outgoing(&self,index:usize)->Option<Outgoing<'_>>{
        if index>=self.manifest.node_count{return None;}
        let offsets=slice(&self.offsets);
        Some(Outgoing{graph:self,pos:u64_at(offsets,index)as usize,
          stop:u64_at(offsets,index+1)as usize})
    }
    pub fn validate(&self)->io::Result<()>{
        let n=self.manifest.node_count;let m=self.manifest.edge_count;
        let ids=slice(&self.nodes);let ofs=slice(&self.offsets);
        if u64_at(ofs,0)!=0 || u64_at(ofs,n)!=m as u64{return Err(bad("invalid CSR start or final offset"));}
        for i in 0..n {
            if i>0 && u64_at(ids,i-1)>=u64_at(ids,i){return Err(bad("node IDs not sorted uniquely"));}
            let a=u64_at(ofs,i);let b=u64_at(ofs,i+1);
            if b<a || b>m as u64 {return Err(bad("nonmonotonic CSR offsets"));}
        }
        let tg=slice(&self.targets);let wt=slice(&self.weights);
        for i in 0..m {
            if u32_at(tg,i)as usize>=n{return Err(bad("edge target index out of range"));}
            let w=f32_at(wt,i);
            if !w.is_finite() || w<=0. {return Err(bad("non-positive or invalid synapse count"));}
        }
        Ok(())
    }
}
pub struct Outgoing<'a>{graph:&'a Graph,pos:usize,stop:usize}
impl Iterator for Outgoing<'_>{
    type Item=(u32,f32);
    fn next(&mut self)->Option<Self::Item>{
        if self.pos>=self.stop{return None;}
        let i=self.pos;self.pos+=1;
        Some((u32_at(slice(&self.graph.targets),i),f32_at(slice(&self.graph.weights),i)))
    }
}
#[derive(Debug,Clone)]
pub struct PropagationConfig {
    pub gain:f32,
    pub minimum_synapses:f32,
    pub max_edges_per_step:usize,
    pub max_active_neurons:usize,
    pub activation_threshold:f32,
}
impl Default for PropagationConfig {
    fn default()->Self{
        Self{gain:0.1,minimum_synapses:1.,
          max_edges_per_step:1_000_000,max_active_neurons:10_000,
          activation_threshold:0.5}
    }
}
/// One exploratory message-passing step along real structural edges.
/// All connections are treated as unsigned because transmitter signs and
/// physiological parameters have not been experimentally assigned.
pub fn propagate(graph:&Graph,active:&[(u32,f32)],
                 cfg:&PropagationConfig)->io::Result<Vec<(u32,f32)>> {
    if !cfg.gain.is_finite()||cfg.gain<=0.||
      !cfg.activation_threshold.is_finite()||cfg.activation_threshold<=0.||
      !cfg.minimum_synapses.is_finite()||cfg.minimum_synapses<=0.{
        return Err(bad("invalid propagation configuration"));
    }
    if active.len()>cfg.max_active_neurons{return Err(bad("active population exceeds budget"));}
    let mut estimates=HashMap::<u32,f32>::new();
    let mut visited_edges=0usize;
    for (idx,drive) in active {
        if *idx as usize>=graph.manifest.node_count|| !drive.is_finite() || *drive<0. {
            return Err(bad("invalid stimulation"));
        }
        let degree=graph.degree(*idx as usize).unwrap();
        visited_edges=visited_edges.checked_add(degree).ok_or_else(||bad("edge budget overflow"))?;
        if visited_edges>cfg.max_edges_per_step {
            return Err(bad("edge budget exceeded; run on a larger machine or smaller subcircuit"));
        }
        for (to,w) in graph.outgoing(*idx as usize).unwrap(){
            if w<cfg.minimum_synapses {continue;}
            *estimates.entry(to).or_insert(0.)+=drive * cfg.gain * w.ln_1p();
        }
    }
    let mut out:Vec<_>=estimates.into_iter()
        .filter(|(_,v)| v.is_finite()&&*v>=cfg.activation_threshold).collect();
    if out.len()>cfg.max_active_neurons {
        return Err(bad("next active population exceeds budget"));
    }
    out.sort_unstable_by_key(|(idx,_)|*idx);
    Ok(out)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn json_requires_provenance(){
        let m=Manifest{format:"devilpet-connectome-csr-v1".into(),
          dataset_id:"male-cns-v1.0-2026".into(),version:"v1.0".into(),
          source:"official".into(),license:"CC-BY-4.0".into(),
          node_count:2,edge_count:1,node_scope:"edge-endpoints".into(),
          edge_semantics:"synapse_count".into(),processing:String::new()};
        m.validate().unwrap();
        let mut invalid=m; invalid.source.clear();
        assert!(invalid.validate().is_err());
    }
}


pub mod ports;
