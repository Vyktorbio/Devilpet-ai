//! DevilPet: portable, headless Rust neural engine.
//!
//! This crate translates the *reduced* JS neuron/plasticity engine.
//! It is NOT a full biological Drosophila brain or ventral nerve cord.
//! The original JS engine is unchanged; the game still uses JavaScript.
//! A portable genome stores inherited settings separately from learned synapses.

pub mod rng;
pub mod sparse;
pub mod odor;
pub mod portable;

pub use odor::{FlyNeuroEthology, OdorSignal, FruitPatch, OdorDecision, OdorSnapshot, PetVitals};
pub use portable::{PortablePet, PortableMind, Genome, CircadianProfile, FORMAT};
pub use rng::Mulberry32;
pub use sparse::{
    ArchitecturalFlyBrain, BrainError, BrainOutput, BrainTelemetry, JsCheckpoint,
    FullSnapshot, Tier,
};

#[cfg(target_arch = "wasm32")]
pub mod wasm;
