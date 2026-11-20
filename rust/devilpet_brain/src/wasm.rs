//! WebAssembly bridge for the two existing reduced DevilPet circuits.
//! All neural calculations take place in Rust. Scene/game state remains JS.
//! No alterations to the original neural-engine.js are needed.
use wasm_bindgen::prelude::*;
use crate::sparse::{ArchitecturalFlyBrain, FullSnapshot, JsCheckpoint, Tier};
use crate::odor::{FlyNeuroEthology, OdorSignal, PetVitals, OdorSnapshot};
use serde::Serialize;

fn err(x: impl std::fmt::Display) -> JsValue { JsValue::from_str(&x.to_string()) }
fn tier(key:&str) -> Result<Tier,JsValue> {
    match key {
        "drosophila" => Ok(Tier::Drosophila),
        "expanded" => Ok(Tier::Expanded),
        "bee" => Ok(Tier::Bee),
        "super" => Ok(Tier::Super),
        _ => Err(err("unknown brain tier")),
    }
}
fn to_js<T:Serialize>(x:&T)->Result<JsValue,JsValue> {
    serde_wasm_bindgen::to_value(x).map_err(err)
}

#[wasm_bindgen]
pub struct WasmSparseBrain {
    inner:ArchitecturalFlyBrain
}
#[wasm_bindgen]
impl WasmSparseBrain {
    #[wasm_bindgen(constructor)]
    pub fn new(tier_key:&str, seed:u32)->Result<WasmSparseBrain,JsValue>{
        Ok(Self{inner:ArchitecturalFlyBrain::new(tier(tier_key)?,seed)})
    }
    pub fn step(&mut self,cyan:f64,amber:f64,red:f64,ball:f64,sky:f64,
                modulation:f64,consolidate:f64,learn:bool,duration_ms:f64)->Result<JsValue,JsValue>{
        let out=self.inner.step_window([cyan,amber,red,ball,sky],modulation,consolidate,learn,duration_ms)
            .map_err(err)?;
        to_js(&out)
    }
    pub fn telemetry(&self)->Result<JsValue,JsValue>{to_js(&self.inner.telemetry())}
    pub fn mbon_rates(&self)->Vec<f64>{self.inner.mbon_rate().to_vec()}
    pub fn get_short_weights(&self)->Vec<f64>{self.inner.short_weights().to_vec()}
    pub fn get_long_weights(&self)->Vec<f64>{self.inner.long_weights().to_vec()}
    pub fn get_tick(&self)->f64{self.inner.tick as f64}
    pub fn set_tick(&mut self,tick:f64)->Result<(),JsValue>{
        if !tick.is_finite()||tick<0.||tick.fract()!=0.||tick>9_007_199_254_740_991.{
            return Err(err("invalid tick"));
        }
        self.inner.tick=tick as u64;Ok(())
    }
    pub fn get_rng_state(&self)->u32{self.inner.rng.state()}
    pub fn set_rng_state(&mut self,v:u32){self.inner.rng.set_state(v);}
    pub fn restore_legacy_json(&mut self,text:&str)->Result<(),JsValue>{
        let cp:JsCheckpoint=serde_json::from_str(text).map_err(err)?;
        self.inner.restore_js_checkpoint(&cp).map_err(err)
    }
    pub fn full_snapshot_json(&self)->Result<String,JsValue>{
        serde_json::to_string(&self.inner.full_snapshot()).map_err(err)
    }
    pub fn restore_full_json(&mut self,text:&str)->Result<(),JsValue>{
        let s:FullSnapshot=serde_json::from_str(text).map_err(err)?;
        self.inner.restore_full_snapshot(&s).map_err(err)
    }
    /// An explicitly invoked reset. The original JS reset handler is preserved.
    pub fn reset_weights(&mut self){
        let mut snap=self.inner.full_snapshot();
        snap.checkpoint.short_w.fill(0.);
        snap.checkpoint.long_w.fill(0.);
        snap.eligibility.fill(0.);
        // restore_full_snapshot only changes synaptic state; no RNG reset.
        self.inner.restore_full_snapshot(&snap).expect("self-generated snapshot");
    }
}

#[wasm_bindgen]
pub struct WasmOdorBrain{inner:FlyNeuroEthology}
#[wasm_bindgen]
impl WasmOdorBrain{
    #[wasm_bindgen(constructor)]
    pub fn new(seed:u32)->Self{Self{inner:FlyNeuroEthology::new(seed)}}
    pub fn choose(&mut self, f0:f64, f1:f64, f2:f64, f3:f64,
                  energy:f64,rest:f64,curiosity:f64)->Result<JsValue,JsValue>{
        let input=[OdorSignal{food:f0},OdorSignal{food:f1},OdorSignal{food:f2},OdorSignal{food:f3}];
        let choice=self.inner.choose(&input,PetVitals{energy,rest,curiosity});
        to_js(&choice)
    }
    pub fn odor_value(&self,i:usize)->f64 {
        if i>=4{return 0.;}
        self.inner.odor_value(i)
    }
    pub fn reinforce(&mut self,i:usize,reward:f64){self.inner.reinforce(i,reward);}
    pub fn rest(&mut self){self.inner.rest();}
    pub fn snapshot_json(&self)->Result<String,JsValue>{
        serde_json::to_string(&self.inner.snapshot()).map_err(err)
    }
    pub fn restore_json(&mut self,text:&str)->Result<(),JsValue>{
        let s:OdorSnapshot=serde_json::from_str(text).map_err(err)?;
        self.inner.restore(&s).map_err(err)
    }
    pub fn get_steps(&self)->f64{self.inner.steps as f64}
    pub fn get_rewards(&self)->f64{self.inner.rewards as f64}
    pub fn get_punishments(&self)->f64{self.inner.punishments as f64}
    pub fn get_visits(&self)->Vec<u32>{self.inner.visits.to_vec()}
    pub fn set_visits(&mut self,visits:Vec<u32>)->Result<(),JsValue>{
        if visits.len()!=4{return Err(err("expected 4 site visits"));}
        self.inner.visits.copy_from_slice(&visits);Ok(())
    }
    pub fn get_heading(&self)->f64{self.inner.heading}
    pub fn set_heading(&mut self,heading:f64){if heading.is_finite(){self.inner.heading=heading;}}
    pub fn get_activity(&self)->String{self.inner.activity.into()}
    pub fn set_activity(&mut self,activity:&str)->Result<(),JsValue>{
        self.inner.activity=match activity{
            "explorar"=>"explorar", "alimentar"=>"alimentar",
            "repousar"=>"repousar", "brincar"=>"brincar",
            _=>return Err(err("invalid activity"))
        };Ok(())
    }
    pub fn get_last_choice(&self)->i32{self.inner.last_choice}
    pub fn set_last_choice(&mut self,v:i32){
        if (-1..=3).contains(&v){self.inner.last_choice=v;}
    }
}
