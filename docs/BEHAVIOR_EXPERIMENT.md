# Experimental perception, motivation and memory (opt-in)
This branch adds `fly/behavior.js`, a **renderer-independent** controller for experiments. The stable website and existing pet saves are unchanged.
The module consumes the output of `fly/sensors.js` and produces `{forward,turn,lift,activity}` plus observability fields. It has no access to absolute world positions, meshes, or targets.

- Perception: bilateral odor gradient, visual contrast, obstacle and contact signals.
- Motivation: competing scores for feeding, rest, avoidance and exploration based on sensed internal state.
- Memory: signed, bounded odor association with reward delivered after a prior observation; deterministic seeded exploration; JSON snapshot and restore.
- Sleep: simple retention/decay, **not** a validated sleep-consolidation model.

Run `node fly/behavior.test.cjs`. To integrate with a future experimental page: call `const frame=DevilPetSensors.sample(world,pose,vitals)`, then `controller.step(frame,{dt,reward})` and send its motor values to a **separate** body actuator. Do not drive the pet's movement simultaneously with the old target-seeking code. Reward should be based on actual food contact or aversive outcome, not distance to a target.

**Scientific limitations:** heuristic controller, not a neuronal connectome; sensor values are uncalibrated. The simplified memory groups all food odors into one cue, so discrimination between distinct odors is not yet demonstrated. It is inappropriate to claim associative odor discrimination, neural realism or full CNS functionality from this code.

**Acceptance gates before activation in the 3D page:** test no regression of stable rollback, ensure one authoritative motor controller per frame, measure trajectory/choice with paired seeds against random baseline, and verify no movement pause after switching controllers.
