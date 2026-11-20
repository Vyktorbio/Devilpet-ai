//! Rust translation of the unchanged, *reduced* browser KC/MBON architecture.
//! Not the fly's complete brain, nor its ventral nerve cord.
use crate::rng::Mulberry32;
use serde::{Deserialize, Serialize};
use std::{error::Error, fmt};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    Drosophila,
    Expanded,
    Bee,
    Super,
}
impl Tier {
    pub fn name(self) -> &'static str {
        match self {
            Self::Drosophila => "Drosophila",
            Self::Expanded => "Expandido",
            Self::Bee => "Abelha-Scale",
            Self::Super => "Super-Colônia",
        }
    }
    pub fn parameters(self) -> TierParameters {
        match self {
            Self::Drosophila => TierParameters { n_kc: 48, n_mbon: 2, fan_in: 4, apl_gain: .35, rec_gain: .05 },
            Self::Expanded => TierParameters { n_kc: 160, n_mbon: 4, fan_in: 3, apl_gain: .55, rec_gain: .14 },
            Self::Bee => TierParameters { n_kc: 420, n_mbon: 6, fan_in: 3, apl_gain: .72, rec_gain: .24 },
            Self::Super => TierParameters { n_kc: 1000, n_mbon: 8, fan_in: 3, apl_gain: .84, rec_gain: .36 },
        }
    }
}
#[derive(Debug, Clone, Copy)]
pub struct TierParameters {
    pub n_kc: usize, pub n_mbon: usize, pub fan_in: usize,
    pub apl_gain: f64, pub rec_gain: f64,
}
#[derive(Debug)]
pub enum BrainError {
    InvalidDuration, InvalidCue, TierMismatch, InvalidCheckpoint(&'static str),
}
impl fmt::Display for BrainError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidDuration => write!(f, "duration must be finite and at least 0.25 ms"),
            Self::InvalidCue => write!(f, "cue intensities must be finite"),
            Self::TierMismatch => write!(f, "checkpoint architecture differs from active architecture"),
            Self::InvalidCheckpoint(x) => write!(f, "invalid checkpoint: {x}"),
        }
    }
}
impl Error for BrainError {}

/// Existing JavaScript checkpoint keys. The browser currently does NOT save
/// KC membrane potentials, eligibility, or recurrent working memory.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JsCheckpoint {
    #[serde(rename = "tierKey")] pub tier_key: Tier,
    pub tick: u64,
    pub rng: u32,
    #[serde(rename = "shortW")] pub short_w: Vec<f64>,
    #[serde(rename = "longW")] pub long_w: Vec<f64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FullSnapshot {
    #[serde(flatten)] pub checkpoint: JsCheckpoint,
    pub eligibility: Vec<f64>,
    pub kc_voltage: Vec<f64>,
    pub mbon_rate: [f64; 5],
    pub working_mem: [f64; 5],
    pub last_active_kc: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrainOutput {
    #[serde(rename = "mbonApproach")] pub mbon_approach: [f64; 5],
    #[serde(rename = "mbonAvoid")] pub mbon_avoid: [f64; 5],
    #[serde(rename = "dnSpikes")] pub dn_spikes: u32,
    #[serde(rename = "sparsityPct")] pub sparsity_pct: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrainTelemetry {
    #[serde(rename = "maxElig")] pub max_elig: f64,
    #[serde(rename = "meanShort")] pub mean_short: f64,
    #[serde(rename = "meanLong")] pub mean_long: f64,
    #[serde(rename = "prefCyan")] pub pref_cyan: f64,
    #[serde(rename = "prefAmber")] pub pref_amber: f64,
    #[serde(rename = "prefRed")] pub pref_red: f64,
    #[serde(rename = "avoidRed")] pub avoid_red: f64,
    #[serde(rename = "prefSky")] pub pref_sky: f64,
}

pub struct ArchitecturalFlyBrain {
    pub tier: Tier,
    pub cfg: TierParameters,
    pub rng: Mulberry32,
    pub tick: u64,
    pub dt_ms: f64,
    kc_pre: Vec<Vec<usize>>,
    kc_cue_tag: Vec<usize>,
    short_w: Vec<f64>,
    long_w: Vec<f64>,
    elig: Vec<f64>,
    kc_v: Vec<f64>,
    mbon_rate: [f64; 5],
    working_mem: [f64; 5],
    last_active_kc: f64,
    ev: f64, ee: f64, es: f64,
}
impl ArchitecturalFlyBrain {
    pub fn new(tier: Tier, seed: u32) -> Self {
        let cfg = tier.parameters();
        let mut rng = Mulberry32::new(seed);
        let mut kc_pre = Vec::with_capacity(cfg.n_kc);
        let mut kc_cue_tag = Vec::with_capacity(cfg.n_kc);
        for k in 0..cfg.n_kc {
            let group = k % 5;
            kc_cue_tag.push(group);
            let base = group * 6;
            let mut inputs = Vec::with_capacity(cfg.fan_in);
            for f in 0..cfg.fan_in {
                let src = if f == 0 || rng.next_f64() < 0.85 {
                    base + (rng.next_f64() * 6.).floor() as usize
                } else {
                    (rng.next_f64() * 30.).floor() as usize
                };
                inputs.push(src);
            }
            kc_pre.push(inputs);
        }
        let n_plastic = cfg.n_kc * 2;
        let dt_ms: f64 = 0.25;
        Self {
            tier, cfg, rng, tick: 0, dt_ms,
            kc_pre, kc_cue_tag,
            short_w: vec![0.; n_plastic], long_w: vec![0.; n_plastic],
            elig: vec![0.; n_plastic], kc_v: vec![0.; cfg.n_kc],
            mbon_rate: [0.; 5], working_mem: [0.; 5],
            last_active_kc: 0.,
            ev: (-dt_ms / 20.).exp(), ee: (-dt_ms / 250.).exp(), es: (-dt_ms / 18000.).exp(),
        }
    }
    pub fn n_kc(&self) -> usize { self.cfg.n_kc }
    pub fn n_plastic(&self) -> usize { self.cfg.n_kc * 2 }
    pub fn mbon_rate(&self) -> &[f64; 5] { &self.mbon_rate }
    pub fn short_weights(&self) -> &[f64] { &self.short_w }
    pub fn long_weights(&self) -> &[f64] { &self.long_w }
    pub fn get_factor(&self, idx: usize) -> f64 {
        (1. + self.short_w[idx] + self.long_w[idx]).max(0.1).min(3.)
    }
    pub fn step_window(&mut self, cue_inputs: [f64; 5], modulation: f64,
                       consolidate: f64, learn: bool,
                       duration_ms: f64) -> Result<BrainOutput, BrainError> {
        if !duration_ms.is_finite() || duration_ms < self.dt_ms || duration_ms > 100_000. {
            return Err(BrainError::InvalidDuration);
        }
        if !cue_inputs.iter().all(|v| v.is_finite()) ||
           !modulation.is_finite() || !consolidate.is_finite() {
            return Err(BrainError::InvalidCue);
        }
        let steps = (duration_ms / self.dt_ms).round() as usize;
        let mut active_kc_sum = 0usize;
        let mut mbon_approach = [0.; 5];
        let mut mbon_avoid = [0.; 5];
        let mut dn_spikes = 0u32;
        let mut sens_prob = [0.; 30];
        for g in 0..5 {
            self.working_mem[g] = self.working_mem[g] * .92 + cue_inputs[g] * .08;
            let eff_cue = (cue_inputs[g] + self.cfg.rec_gain * self.working_mem[g]).min(1.);
            let p = eff_cue * .14;
            for i in 0..6 { sens_prob[g * 6 + i] = p; }
        }
        let cons_frac = if consolidate > 0. {
            -(-consolidate * self.dt_ms / 550.).exp_m1()
        } else { 0. };
        let lr = .42;
        for _ in 0..steps {
            let mut sens_spk = [0u8; 30];
            for i in 0..30 {
                if self.rng.next_f64() < sens_prob[i] { sens_spk[i] = 1; }
            }
            let mut kc_sum_v = 0.;
            for k in 0..self.n_kc() {
                let mut inp = 0.;
                for src in &self.kc_pre[k] {
                    inp += sens_spk[*src] as f64 * 3.8;
                }
                self.kc_v[k] = self.ev * self.kc_v[k] + inp + (self.rng.next_f64() - .5) * .22;
                kc_sum_v += self.kc_v[k].max(0.);
            }
            let apl_inh = self.cfg.apl_gain * (kc_sum_v / self.n_kc() as f64);
            let mut fired_count = 0usize;
            for k in 0..self.n_kc() {
                let net_v = self.kc_v[k] - apl_inh;
                let cue = self.kc_cue_tag[k];
                let e_app = k * 2;
                let e_avd = e_app + 1;
                self.elig[e_app] *= self.ee;
                self.elig[e_avd] *= self.ee;
                if net_v > 2.55 {
                    self.kc_v[k] = 0.;
                    fired_count += 1;
                    let f_app = self.get_factor(e_app);
                    let f_avd = self.get_factor(e_avd);
                    mbon_approach[cue] += f_app;
                    mbon_avoid[cue] += f_avd;
                    self.elig[e_app] = (self.elig[e_app] + .65).min(1.);
                    self.elig[e_avd] = (self.elig[e_avd] + .65).min(1.);
                }
                self.short_w[e_app] *= self.es;
                self.short_w[e_avd] *= self.es;
                if learn && modulation != 0. {
                    let delta = lr * modulation * self.elig[e_app] * (self.dt_ms / 250.);
                    self.short_w[e_app] = (self.short_w[e_app] + delta)
                        .max(-.9 - self.long_w[e_app]).min(2. - self.long_w[e_app]);
                    self.short_w[e_avd] = (self.short_w[e_avd] - delta)
                        .max(-.9 - self.long_w[e_avd]).min(2. - self.long_w[e_avd]);
                }
                if cons_frac > 0. {
                    let tr_a = self.short_w[e_app] * cons_frac;
                    self.long_w[e_app] += tr_a;
                    self.short_w[e_app] -= tr_a;
                    let tr_b = self.short_w[e_avd] * cons_frac;
                    self.long_w[e_avd] += tr_b;
                    self.short_w[e_avd] -= tr_b;
                }
            }
            active_kc_sum += fired_count;
            self.tick += 1;
        }
        let norm = ((self.n_kc() as f64 / 5.) * .45).max(1.);
        for g in 0..5 {
            self.mbon_rate[g] = (mbon_approach[g] - mbon_avoid[g]) / norm;
            dn_spikes += ((mbon_approach[g] + mbon_avoid[g]) * .22).round() as u32;
        }
        self.last_active_kc = active_kc_sum as f64 / steps as f64;
        Ok(BrainOutput {
            mbon_approach, mbon_avoid, dn_spikes,
            sparsity_pct: (100. * (1. - self.last_active_kc / self.n_kc() as f64)).min(100.),
        })
    }
    pub fn telemetry(&self) -> BrainTelemetry {
        let mut max_elig: f64 = 0.;
        let (mut sum_short, mut sum_long) = (0., 0.);
        let (mut c_app, mut a_app, mut r_app, mut r_avd, mut s_app) = (0.,0.,0.,0.,0.);
        let (mut c_n, mut a_n, mut r_n, mut s_n) = (0.,0.,0.,0.);
        for k in 0..self.n_kc() {
            let e_app = k * 2;
            let e_avd = e_app + 1;
            max_elig = max_elig.max(self.elig[e_app]);
            sum_short += self.short_w[e_app].abs() + self.short_w[e_avd].abs();
            sum_long += self.long_w[e_app].abs() + self.long_w[e_avd].abs();
            match self.kc_cue_tag[k] {
                0 => { c_app += self.get_factor(e_app); c_n += 1; },
                1 => { a_app += self.get_factor(e_app); a_n += 1; },
                2 => { r_app += self.get_factor(e_app); r_avd += self.get_factor(e_avd); r_n += 1; },
                4 => { s_app += self.get_factor(e_app); s_n += 1; },
                _ => (),
            }
        }
        BrainTelemetry {
            max_elig,
            mean_short: sum_short / self.n_plastic().max(1) as f64,
            mean_long: sum_long / self.n_plastic().max(1) as f64,
            pref_cyan: c_app / c_n.max(1) as f64,
            pref_amber: a_app / a_n.max(1) as f64,
            pref_red: r_app / r_n.max(1) as f64,
            avoid_red: r_avd / r_n.max(1) as f64,
            pref_sky: s_app / s_n.max(1) as f64,
        }
    }
    pub fn js_checkpoint(&self) -> JsCheckpoint {
        JsCheckpoint { tier_key: self.tier, tick: self.tick, rng: self.rng.state(),
            short_w: self.short_w.clone(), long_w: self.long_w.clone() }
    }
    pub fn restore_js_checkpoint(&mut self, cp: &JsCheckpoint) -> Result<(), BrainError> {
        if self.tier != cp.tier_key { return Err(BrainError::TierMismatch); }
        if cp.short_w.len() != self.n_plastic() || cp.long_w.len() != self.n_plastic() {
            return Err(BrainError::InvalidCheckpoint("weight length"));
        }
        if !cp.short_w.iter().chain(&cp.long_w).all(|w| w.is_finite()) {
            return Err(BrainError::InvalidCheckpoint("non-finite weights"));
        }
        self.short_w.clone_from(&cp.short_w);
        self.long_w.clone_from(&cp.long_w);
        self.tick = cp.tick;
        self.rng.set_state(cp.rng);
        self.elig.fill(0.);
        self.kc_v.fill(0.);
        self.mbon_rate.fill(0.);
        self.working_mem.fill(0.);
        self.last_active_kc = 0.;
        Ok(())
    }
    pub fn full_snapshot(&self) -> FullSnapshot {
        FullSnapshot { checkpoint:self.js_checkpoint(),eligibility:self.elig.clone(),
            kc_voltage:self.kc_v.clone(),mbon_rate:self.mbon_rate,
            working_mem:self.working_mem,last_active_kc:self.last_active_kc }
    }
    pub fn restore_full_snapshot(&mut self, snapshot: &FullSnapshot) -> Result<(), BrainError> {
        if snapshot.eligibility.len()!=self.n_plastic() || snapshot.kc_voltage.len()!=self.n_kc() ||
           !snapshot.eligibility.iter().chain(&snapshot.kc_voltage).all(|v|v.is_finite()) ||
           !snapshot.mbon_rate.iter().chain(&snapshot.working_mem).all(|v|v.is_finite()) ||
           !snapshot.last_active_kc.is_finite() {
            return Err(BrainError::InvalidCheckpoint("full snapshot arrays"));
        }
        self.restore_js_checkpoint(&snapshot.checkpoint)?;
        self.elig.clone_from(&snapshot.eligibility);
        self.kc_v.clone_from(&snapshot.kc_voltage);
        self.mbon_rate = snapshot.mbon_rate;
        self.working_mem = snapshot.working_mem;
        self.last_active_kc = snapshot.last_active_kc;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn cues() -> [f64;5] { [.75,.05,.1,.4,.5] }

    #[test]
    fn architecture_includes_all_reference_tiers() {
        assert_eq!(Tier::Drosophila.parameters().n_kc,48);
        assert_eq!(Tier::Bee.parameters().n_kc,420);
        assert_eq!(Tier::Super.parameters().n_kc,1000);
    }

    #[test]
    fn seeded_replay_is_deterministic() {
        for tier in [Tier::Drosophila,Tier::Expanded,Tier::Bee,Tier::Super] {
            let mut a=ArchitecturalFlyBrain::new(tier,42);
            let mut b=ArchitecturalFlyBrain::new(tier,42);
            for step in 0..4 {
                let r1=a.step_window(cues(),if step%2==0 {1.}else{0.},.02,true,15.).unwrap();
                let r2=b.step_window(cues(),if step%2==0 {1.}else{0.},.02,true,15.).unwrap();
                assert_eq!(serde_json::to_value(&r1).unwrap(),serde_json::to_value(&r2).unwrap());
                assert_eq!(a.js_checkpoint(),b.js_checkpoint());
            }
        }
    }
    #[test]
    fn full_snapshot_replays_future_events() {
        let mut a=ArchitecturalFlyBrain::new(Tier::Drosophila,42);
        a.step_window(cues(),1.,.05,true,15.).unwrap();
        let snap=a.full_snapshot();
        let mut b=ArchitecturalFlyBrain::new(Tier::Drosophila,999);
        b.restore_full_snapshot(&snap).unwrap();
        for _ in 0..4 {
            let x=a.step_window(cues(),-.5,.5,true,15.).unwrap();
            let y=b.step_window(cues(),-.5,.5,true,15.).unwrap();
            assert_eq!(serde_json::to_value(&x).unwrap(),serde_json::to_value(&y).unwrap());
        }
    }
    #[test]
    fn browser_checkpoint_roundtrip() {
        let mut a=ArchitecturalFlyBrain::new(Tier::Bee,42);
        a.step_window(cues(),1.,.02,true,15.).unwrap();
        let x=a.js_checkpoint();
        let json=serde_json::to_string(&x).unwrap();
        assert!(json.contains(r#""tierKey":"bee""#));
        let cp:JsCheckpoint=serde_json::from_str(&json).unwrap();
        let mut b=ArchitecturalFlyBrain::new(Tier::Bee,42);
        b.restore_js_checkpoint(&cp).unwrap();
        assert_eq!(a.js_checkpoint(),b.js_checkpoint());
    }
}
