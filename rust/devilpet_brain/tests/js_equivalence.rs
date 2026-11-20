//! Compare Rust output with reference vectors produced by unmodified JavaScript.
use devilpet_brain::{ArchitecturalFlyBrain, Tier};
use serde_json::Value;

fn near(a:f64,b:f64,context:&str){
    let tol=2e-10*b.abs().max(1.);
    assert!((a-b).abs()<=tol, "{context}: Rust={a:?} JS={b:?}");
}
fn compare_numeric_json(a:&Value,b:&Value,label:&str){
    match (a,b){
        (Value::Number(x),Value::Number(y))=>{
            if let (Some(x),Some(y))=(x.as_f64(),y.as_f64()){near(x,y,label);}
        },
        (Value::Array(x),Value::Array(y))=>{
            assert_eq!(x.len(),y.len(),"{label}: array length");
            for (i,(v,w)) in x.iter().zip(y).enumerate(){compare_numeric_json(v,w,&format!("{label}[{i}]"));}
        },
        (Value::Object(x),Value::Object(y))=>{
            for (k,v) in y{
                compare_numeric_json(&x[k],v,&format!("{label}.{k}"));
            }
        },
        _=>assert_eq!(a,b,"{label}"),
    }
}
#[test]
fn reference_vectors_match_javascript_for_every_tier(){
    let f:Value=serde_json::from_str(include_str!("golden_browser.json")).unwrap();
    for case in f["cases"].as_array().unwrap(){
        let tier:Tier=serde_json::from_value(case["tier"].clone()).unwrap();
        let seed=case["seed"].as_u64().unwrap() as u32;
        let mut brain=ArchitecturalFlyBrain::new(tier,seed);
        for (i,(act,expected)) in f["actions"].as_array().unwrap().iter()
            .zip(case["results"].as_array().unwrap()).enumerate(){
            let c=&act["cues"];
            let cues=std::array::from_fn(|j|c[j].as_f64().unwrap());
            let result=brain.step_window(cues,act["modulation"].as_f64().unwrap(),
                act["consolidate"].as_f64().unwrap(),act["learn"].as_bool().unwrap(),
                act["duration"].as_f64().unwrap()).unwrap();
            let checkpoint=brain.js_checkpoint();
            let label=format!("{tier:?} step {i}");
            assert_eq!(brain.tick,expected["tick"].as_u64().unwrap(),"{label}: tick");
            assert_eq!(brain.rng.state(),expected["rng"].as_u64().unwrap() as u32,"{label}: rng");
            compare_numeric_json(&serde_json::to_value(result).unwrap(),&expected["output"],&label);
            compare_numeric_json(&serde_json::to_value(brain.telemetry()).unwrap(),
                &expected["telemetry"],&label);
            for (j,w) in checkpoint.short_w.iter().take(12).enumerate(){
                near(*w,expected["firstShort"][j].as_f64().unwrap(),&format!("{label}: shortW[{j}]"));
            }
            for (j,w) in checkpoint.long_w.iter().take(12).enumerate(){
                near(*w,expected["firstLong"][j].as_f64().unwrap(),&format!("{label}: longW[{j}]"));
            }
            near(checkpoint.short_w.iter().map(|x|x.abs()).sum(),
                expected["absShort"].as_f64().unwrap(),&format!("{label}: absShort"));
            near(checkpoint.long_w.iter().map(|x|x.abs()).sum(),
                expected["absLong"].as_f64().unwrap(),&format!("{label}: absLong"));
        }
    }
}
