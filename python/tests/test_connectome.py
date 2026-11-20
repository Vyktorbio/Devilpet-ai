"""Tests on DECLARED SYNTHETIC fixture: no invented 'real' neurons.

Verifies Python reads the exact same binary CSR produced by the existing
scientific importer, rejects stale evidence and serves the browser protocol.
"""
from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from connectome_engine import ConnectomeGraph, ConnectomeController, ConnectomeError
from connectome_server import make_server


class GraphTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name) / "graph"
        self.folder.mkdir()
        self.ids = [100, 200, 300, 9_007_199_254_740_993]
        self.edges = 4
        for name, values, dtype in [
            ("nodes.u64", self.ids, "<u8"),
            ("offsets.u64", [0, 2, 3, 4, 4], "<u8"),
            ("targets.u32", [1, 2, 2, 3], "<u4"),
            ("weights.f32", [1000., 1., 1000., 1000.], "<f4")
        ]:
            np.asarray(values, dtype=dtype).tofile(self.folder / name)
        (self.folder / "manifest.json").write_text(json.dumps({
            "format": "devilpet-connectome-csr-v1",
            "dataset_id": "synthetic-fixture-only",
            "version": "v1",
            "source": "synthetic://fixture",
            "license": "test",
            "node_count": 4,
            "edge_count": 4,
            "edge_semantics": "synapse_count",
            "node_scope": "fixture"
        }))
        self.ports = Path(self.tmp.name) / "ports.json"
        self.mapping = {
            "format": "devilpet-connectome-ports-v1",
            "dataset_id": "synthetic-fixture-only",
            "version": "v1",
            "annotation_source": "synthetic://fixture",
            "reviewed_by": "synthetic-test-not-a-biologist",
            "reviewed_at": "2026-11-20",
            "sensors": {
                "odor_left": [{"body_id": 100, "annotation": "test input", "evidence": "synthetic test"}]
            },
            "motors": {
                "forward": [{"body_id": 200, "annotation": "test output", "evidence": "synthetic test"}],
                "turn_left": [{"body_id": 200, "annotation": "test output", "evidence": "synthetic test"}],
                "turn_right": [{"body_id": 300, "annotation": "test output", "evidence": "synthetic test"}],
                "lift": [{"body_id": self.ids[-1], "annotation": "test output", "evidence": "synthetic test"}]
            }
        }
        self.save_ports()
        self.graph = ConnectomeGraph(self.folder)

    def save_ports(self):
        self.ports.write_text(json.dumps(self.mapping), encoding="utf8")

    def controller(self):
        return ConnectomeController(self.graph, self.ports)

    def test_graph_exact_ids_and_directed_duplicates(self):
        self.assertEqual(self.graph.index_of(9_007_199_254_740_993), 3)
        self.assertEqual(self.graph.node_count, 4)
        self.assertEqual(self.graph.edge_count, 4)
        t, w = self.graph.outgoing(0)
        self.assertEqual(t.tolist(), [1, 2])
        self.assertEqual(w.tolist(), [1000., 1.])
        with self.assertRaises(ConnectomeError):
            self.graph.index_of(9_007_199_254_740_992)

    def test_preserves_memory_map_without_mutation(self):
        self.assertIsInstance(self.graph.targets, np.memmap)
        self.assertFalse(self.graph.targets.flags.writeable)
        before = self.graph.weights.copy()
        self.controller().step({"odor_left": .9}, hops=3)
        np.testing.assert_array_equal(self.graph.weights, before)

    def test_verified_ports_produce_finite_bounded_motors(self):
        result = self.controller().step({"odor_left": 1.}, hops=3)
        self.assertTrue(0 <= result["forward"] <= 1)
        self.assertTrue(-1 <= result["turn"] <= 1)
        self.assertTrue(0 <= result["lift"] <= 1)
        self.assertGreater(result["forward"], 0)
        self.assertGreater(result["activity"], 0)

    def test_refuses_unverified_or_mismatched_ports(self):
        self.mapping["version"] = "different-specimen"
        self.save_ports()
        with self.assertRaises(ConnectomeError):
            self.controller()
        self.mapping["version"] = "v1"
        self.mapping["motors"]["lift"][0]["body_id"] = 999999
        self.save_ports()
        with self.assertRaises(ConnectomeError):
            self.controller()

    def test_rejects_corrupt_csr_and_bad_sensor_values(self):
        for invalid in ({"odor_left": -1}, {"odor_left": float("nan")},
                        {"fabricated": .1}):
            with self.assertRaises(ConnectomeError):
                self.controller().step(invalid)
        self.graph.weights.flush()
        wrong = np.memmap(self.folder / "targets.u32", dtype="<u4", mode="r+")
        wrong[0] = 5555
        wrong.flush()
        del wrong
        with self.assertRaises(ConnectomeError):
            ConnectomeGraph(self.folder)

    def test_rejects_unbounded_computation(self):
        limited = ConnectomeController(self.graph, self.ports, max_edges=1)
        with self.assertRaises(ConnectomeError):
            limited.step({"odor_left": 1.})

    def test_http_protocol_and_cors(self):
        server = make_server(self.graph, self.controller(), port=0)
        self.addCleanup(server.server_close)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.shutdown)
        url = f"http://127.0.0.1:{server.server_port}"
        with urlopen(Request(url + "/health", headers={
            "Origin": "https://vyktorbio.github.io"
        })) as response:
            health = json.load(response)
            self.assertEqual(health["backend"], "python")
            self.assertEqual(health["full_cns_assigned"], False)
            self.assertEqual(response.headers["Access-Control-Allow-Origin"],
                             "https://vyktorbio.github.io")
        msg = json.dumps({
            "sample_id": 4, "hops": 3, "channels": {"odor_left": 1.}
        }).encode()
        with urlopen(Request(url + "/step", data=msg, method="POST", headers={
            "Origin": "https://vyktorbio.github.io",
            "Content-Type": "application/json"
        })) as response:
            answer = json.load(response)
            self.assertEqual(answer["sample_id"], 4)
            self.assertEqual(answer["schema"], "devilpet-cns-output-v1")
            self.assertGreater(answer["motor"]["forward"], 0)
        with self.assertRaises(HTTPError) as err:
            urlopen(Request(url + "/health", headers={
                "Origin": "https://untrusted.example"
            }))
        self.assertEqual(err.exception.code, 403)

    def test_refuses_public_server(self):
        with self.assertRaises(ValueError):
            make_server(self.graph, self.controller(), host="0.0.0.0", port=0)


if __name__ == "__main__":
    unittest.main()
