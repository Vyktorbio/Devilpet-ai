//! Small CLI for Rust-only use; never edits the browser's saved fly.
use devilpet_brain::{
    ArchitecturalFlyBrain, FlyNeuroEthology, Genome, PortablePet, Tier,
};
use serde_json::{json, Value};
use std::{error::Error, fs};

fn usage() -> &'static str {
    "usage:\n  cargo run --bin devilpet-reference -- demo\n  cargo run --bin devilpet-reference -- import-browser BACKUP.json LINEAGE_ID\n  cargo run --bin devilpet-reference -- validate PORTABLE.json\n  cargo run --bin devilpet-reference -- breed A.json B.json CHILD_ID SEED\n\nJSON results are printed to stdout; redirect to a file with > output.json."
}
fn main() -> Result<(), Box<dyn Error>> {
    let a:Vec<String>=std::env::args().collect();
    if a.len()<2 {eprintln!("{}",usage());return Ok(());}
    match a[1].as_str(){
        "demo" if a.len()==2 => {
            let mut brain=ArchitecturalFlyBrain::new(Tier::Drosophila,42);
            let out=brain.step_window([0.75,0.05,0.10,0.4,0.5],1.,0.02,true,15.)?;
            println!("{}",serde_json::to_string_pretty(&json!({
                "engine":"rust-reduced-reference","output":out,
                "telemetry":brain.telemetry(),"checkpoint":brain.js_checkpoint()
            }))?);
        },
        "import-browser" if a.len()==4 => {
            let json:Value=serde_json::from_str(&fs::read_to_string(&a[2])?)?;
            let checkpoint=json.get("checkpoint").ok_or("missing checkpoint")?;
            let t=checkpoint.get("tierKey").ok_or("missing tierKey")?;
            let tier:Tier=serde_json::from_value(t.clone())?;
            // The existing browser always constructs sparse KC wiring with seed 42,
            // then restores the saved RNG state. Do not confuse those values.
            let genome=Genome::founder(a[3].clone(),tier,42,"America/Sao_Paulo");
            let pet=PortablePet::from_browser_backup(&json,genome)?;
            println!("{}",serde_json::to_string_pretty(&pet)?);
        },
        "validate" if a.len()==3 => {
            let pet:PortablePet=serde_json::from_str(&fs::read_to_string(&a[2])?)?;
            pet.validate()?;
            let (brain,odor)=pet.load_engines()?;
            println!("{}",serde_json::to_string_pretty(&json!({
                "valid":true,"lineage":pet.genome.lineage_id,"tier":brain.tier,
                "neurons":{"kenyon":brain.n_kc(),"plastic_synapses":brain.n_plastic()},
                "odor_rewards":odor.rewards,
                "note":"This validates serialized state, not biological realism."
            }))?);
        },
        "breed" if a.len()==6 => {
            let first:PortablePet=serde_json::from_str(&fs::read_to_string(&a[2])?)?;
            let second:PortablePet=serde_json::from_str(&fs::read_to_string(&a[3])?)?;
            first.validate()?;second.validate()?;
            let seed:u32=a[5].parse()?;
            let child=PortablePet::child_from(&first,&second,a[4].clone(),seed);
            println!("{}",serde_json::to_string_pretty(&child)?);
        },
        _ => eprintln!("{}",usage()),
    }
    Ok(())
}
