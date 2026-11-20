//! DevilPet: portable, headless Rust neural engine.
//!
//! This is a port of the current simplified JS neuron/plasticity engine.
//! It is NOT a complete Drosophila connectome or a biological validation.
//! The browser's neural-engine.js is an independent, unmodified reference.
//! Browser geometry, action selection, circadian control, and game UI are not
//! part of the sparse KC/MBON circuit.

pub mod rng;
pub mod sparse;
pub mod odor;

pub use odor::{FlyNeuroEthology, OdorSignal, FruitPatch, OdorDecision, OdorSnapshot};
pub use rng::Mulberry32;
pub use sparse::{ArchitecturalFlyBrain, BrainError, BrainOutput, BrainTelemetry, JsCheckpoint, Tier};
