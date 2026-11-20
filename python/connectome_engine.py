"""Python reference engine for *one* published adult Drosophila CNS graph.

Read-only, memory-mapped CSR preserves every directed original body ID and
synapse-count edge. The activity rule is an EXPERIMENTAL unsigned message pass,
not inferred neuronal electrophysiology or a simulation of consciousness.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

REQUIRED_MOTORS = ("forward", "turn_left", "turn_right", "lift")
ALLOWED_SENSORS = frozenset((
    "odor_left", "odor_right", "vision_left", "vision_right",
    "mechanical_front", "taste_food", "touch", "altitude", "internal_state"
))


class ConnectomeError(ValueError):
    """Invalid graph, evidence map, or sensor input: refuse to run."""


class ConnectomeGraph:
    def __init__(self, directory: str | Path):
        path = Path(directory)
        self.manifest = json.loads((path / "manifest.json").read_text(encoding="utf8"))
        m = self.manifest
        if m.get("format") != "devilpet-connectome-csr-v1":
            raise ConnectomeError("Unsupported CSR format")
        if m.get("edge_semantics") != "synapse_count":
            raise ConnectomeError("Unknown edge semantics")
        if any(not m.get(key) for key in ("dataset_id", "version", "source", "license")):
            raise ConnectomeError("Missing dataset provenance")
        self.node_count = int(m["node_count"])
        self.edge_count = int(m["edge_count"])
        n, e = self.node_count, self.edge_count
        if not 0 < n < 2**32 or e < 0:
            raise ConnectomeError("Out-of-range graph dimensions")
        schema = [
            ("nodes", "nodes.u64", "<u8", n),
            ("offsets", "offsets.u64", "<u8", n + 1),
            ("targets", "targets.u32", "<u4", e),
            ("weights", "weights.f32", "<f4", e)
        ]
        for attr, name, dtype, count in schema:
            file = path / name
            if file.stat().st_size != count * np.dtype(dtype).itemsize:
                raise ConnectomeError(f"Invalid CSR file size: {name}")
            setattr(self, attr, np.memmap(file, mode="r", dtype=dtype, shape=(count,))
                    if count else np.empty(0, dtype=dtype))
        if self.offsets[0] != 0 or int(self.offsets[-1]) != e:
            raise ConnectomeError("Invalid CSR edge offsets")
        if np.any(self.nodes[1:] <= self.nodes[:-1]):
            raise ConnectomeError("Original body IDs are not sorted and unique")
        if np.any(self.offsets[1:] < self.offsets[:-1]):
            raise ConnectomeError("Nonmonotonic CSR row pointers")
        # Full integrity scan is intentionally chunked: datasets may exceed RAM.
        for offset in range(0, e, 1_000_000):
            stop = min(offset + 1_000_000, e)
            if np.any(self.targets[offset:stop] >= n):
                raise ConnectomeError("Edge target index outside graph")
            weights = self.weights[offset:stop]
            if np.any(~np.isfinite(weights)) or np.any(weights <= 0):
                raise ConnectomeError("Invalid original synapse counts")

    def index_of(self, body_id: int) -> int:
        if isinstance(body_id, bool) or not isinstance(body_id, int) or not 0 <= body_id < 2**64:
            raise ConnectomeError("Body ID must be an unsigned 64-bit integer")
        # Cast to uint64 BEFORE searching, avoiding >2**53 precision loss.
        original = np.uint64(body_id)
        pos = int(np.searchsorted(self.nodes, original))
        if pos >= self.node_count or self.nodes[pos] != original:
            raise ConnectomeError(f"Neuron/body ID {body_id} absent from this dataset")
        return pos

    def outgoing(self, index: int):
        if not 0 <= index < self.node_count:
            raise ConnectomeError("Neuron index out of range")
        begin = int(self.offsets[index])
        end = int(self.offsets[index + 1])
        return self.targets[begin:end], self.weights[begin:end]


class ConnectomeController:
    def __init__(self, graph: ConnectomeGraph, port_file: str | Path,
                 *, gain: float = 0.1, min_synapses: float = 1.,
                 threshold: float = 0.5, max_edges: int = 1_000_000,
                 max_active: int = 10_000):
        self.graph = graph
        self.ports = json.loads(Path(port_file).read_text(encoding="utf8"))
        p = self.ports
        m = graph.manifest
        if p.get("format") != "devilpet-connectome-ports-v1":
            raise ConnectomeError("Invalid neuron port map format")
        if p.get("dataset_id") != m["dataset_id"] or p.get("version") != m["version"]:
            raise ConnectomeError("Neuron map references a DIFFERENT specimen/version")
        if any(not str(p.get(k, "")).strip() for k in
               ("annotation_source", "reviewed_by", "reviewed_at")):
            raise ConnectomeError("Original annotation evidence and review required")
        if any(not math.isfinite(v) or v <= 0 for v in (gain, min_synapses, threshold)):
            raise ConnectomeError("Invalid experimental propagation parameters")
        if max_edges <= 0 or max_active <= 0:
            raise ConnectomeError("Invalid computation budget")
        self.gain, self.min_synapses, self.threshold = gain, min_synapses, threshold
        self.max_edges, self.max_active = max_edges, max_active
        sensors = p.get("sensors")
        motors = p.get("motors")
        if not isinstance(sensors, dict) or not sensors:
            raise ConnectomeError("Missing verified sensory ports")
        if not isinstance(motors, dict) or any(not motors.get(k) for k in REQUIRED_MOTORS):
            raise ConnectomeError("Missing required verified motor groups")
        if any(k not in ALLOWED_SENSORS for k in sensors):
            raise ConnectomeError("Unknown sensory channel")
        if any(k not in REQUIRED_MOTORS for k in motors):
            raise ConnectomeError("Unknown motor command")
        self.sensors = self._translate_groups(sensors)
        self.motors = self._translate_groups(motors)

    def _translate_groups(self, groups):
        translated = {}
        for label, entries in groups.items():
            if not isinstance(entries, list) or not entries:
                raise ConnectomeError(f"No annotated neurons for {label}")
            indices, seen = [], set()
            for item in entries:
                if not isinstance(item, dict):
                    raise ConnectomeError("Neuron annotation must be an object")
                body_id = item.get("body_id")
                if body_id in seen:
                    raise ConnectomeError(f"Repeated body ID in {label}")
                seen.add(body_id)
                if any(not isinstance(item.get(k), str) or
                       not item[k].strip() for k in ("annotation", "evidence")):
                    raise ConnectomeError(f"Missing original evidence for {body_id}")
                indices.append(self.graph.index_of(body_id))
            translated[label] = np.asarray(indices, dtype=np.int64)
        return translated

    def step(self, observations: dict, hops: int = 3) -> dict:
        if not isinstance(observations, dict):
            raise ConnectomeError("Expected sensor channels object")
        if isinstance(hops, bool) or not isinstance(hops, int) or not 1 <= hops <= 5:
            raise ConnectomeError("Propagation hops must be between 1 and 5")
        for key, value in observations.items():
            if key not in ALLOWED_SENSORS or isinstance(value, bool) or \
               not isinstance(value, (float, int)) or not math.isfinite(value) or \
               not 0 <= value <= 1:
                raise ConnectomeError(f"Invalid sensor value for {key}")
        state = {}
        for key, indices in self.sensors.items():
            drive = float(observations.get(key, 0))
            if drive:
                per_cell = drive / math.sqrt(len(indices))
                for idx in indices:
                    k = int(idx)
                    state[k] = state.get(k, 0.0) + per_cell
        if len(state) > self.max_active:
            raise ConnectomeError("Initial active population exceeds budget")
        peak = dict(state)
        for _ in range(hops):
            edge_total = sum(
                int(self.graph.offsets[idx + 1] - self.graph.offsets[idx])
                for idx in state
            )
            if edge_total > self.max_edges:
                raise ConnectomeError("Synaptic edge budget exceeded")
            # Only edges present in the loaded original graph are visited.
            # A dense 200k neuron accumulator costs ~1.6 MB, not gigabytes.
            signals = np.zeros(self.graph.node_count, dtype=np.float64)
            for index, drive in state.items():
                dest, weights = self.graph.outgoing(index)
                valid = weights >= self.min_synapses
                if np.any(valid):
                    np.add.at(signals, dest[valid],
                              drive * self.gain * np.log1p(weights[valid]))
            active = np.flatnonzero(signals >= self.threshold)
            if len(active) > self.max_active:
                raise ConnectomeError("Next active population exceeds budget")
            state = {int(i): float(signals[i]) for i in active}
            for idx, value in state.items():
                peak[idx] = max(value, peak.get(idx, 0.0))
            if not state:
                break
        def mean(name):
            ids = self.motors[name]
            return sum(peak.get(int(idx), 0.) for idx in ids) / len(ids)
        forward, left, right, lift = (mean(x) for x in REQUIRED_MOTORS)
        return {
            "forward": max(0., math.tanh(forward * .2)),
            "turn": max(-1., min(1., math.tanh((right - left) * .2))),
            "lift": max(0., math.tanh(lift * .2)),
            "activity": min(1000., forward + left + right + lift)
        }
