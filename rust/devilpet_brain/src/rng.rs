//! Bit-compatible port of createRng() / JS Math.imul and >>> semantics.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Mulberry32 {
    state: u32,
}

impl Mulberry32 {
    pub fn new(seed: u32) -> Self { Self { state: seed } }
    pub fn state(&self) -> u32 { self.state }
    pub fn set_state(&mut self, value: u32) { self.state = value; }

    pub fn next_f64(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x6D2B79F5);
        let s = self.state;
        let mut t = (s ^ (s >> 15)).wrapping_mul(1 | s);
        t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        (t ^ (t >> 14)) as f64 / 4_294_967_296.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn seeded_reference_matches_browser_mulberry32() {
        let mut rng = Mulberry32::new(42);
        let js = [
            0.6011037519201636, 0.44829055899754167,
            0.8524657934904099, 0.6697340414393693,
            0.17481389874592423
        ];
        for expected in js { assert_eq!(rng.next_f64(), expected); }
        let state = rng.state();
        rng.set_state(state);
        assert_eq!(rng.state(), state);
    }
}
