"""Regression against full-input streaming CSR; synthetic stress DATA ONLY.

This does not test biological realism. It proves exact directed graph import,
large 64-bit body IDs, duplicate edges and original within-source order.
"""
from __future__ import annotations
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import numpy as np

SCRIPT = Path(__file__).resolve().parents[1] / "import_graph.py"


class BulkCsrImportTest(unittest.TestCase):
    def test_million_feather_edges_preserves_order_and_weights(self):
        try:
            import pyarrow as pa
            import pyarrow.feather as feather
        except ImportError:
            self.skipTest("Install pyarrow")
        size = 1_000_000
        groups = 1_201
        base = np.int64(9_007_199_254_740_993)
        idx = np.arange(size, dtype=np.int64)
        # One million edges across irregular, interleaved source IDs.
        pre = (base + ((idx * 13 + 17) % groups)).astype(np.uint64)
        post = (base + ((idx * 31 + 21) % groups)).astype(np.uint64)
        weight = ((idx * 7) % 47 + 1).astype(np.int64)
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            edge_file = folder / "large.feather"
            feather.write_feather(
                pa.table({"body_pre": pre, "body_post": post, "weight": weight}),
                edge_file, chunksize=25_000
            )
            out = folder / "compiled"
            result = subprocess.run([
                sys.executable, "-u", str(SCRIPT),
                "--edges", str(edge_file),
                "--dataset", "synthetic-volume-test",
                "--version", "test1",
                "--source", "synthetic://not-official",
                "--license", "fixture",
                "--out", str(out),
                "--batch-size", "50_000",
            ], text=True, capture_output=True, timeout=160)
            self.assertEqual(result.returncode, 0, result.stdout + "\n" + result.stderr)
            meta = json.loads((out / "manifest.json").read_text())
            self.assertEqual(meta["edge_count"], size)
            self.assertEqual(meta["node_count"], groups)
            node_ids = np.fromfile(out / "nodes.u64", dtype="<u8")
            offsets = np.fromfile(out / "offsets.u64", dtype="<u8")
            targets = np.fromfile(out / "targets.u32", dtype="<u4")
            weights = np.fromfile(out / "weights.f32", dtype="<f4")
            self.assertEqual(len(targets), size)
            self.assertEqual(len(weights), size)
            self.assertEqual(offsets[-1], size)
            np.testing.assert_array_equal(node_ids, (base + np.arange(groups)).astype(np.uint64))
            np.testing.assert_array_equal(np.bincount(
                np.searchsorted(node_ids, pre.astype(np.uint64)), minlength=groups
            ), np.diff(offsets))
            # Verify all entries (not just a checksum) for selected presynaptic
            # body IDs; duplicate synapses and source input order are retained.
            for original in [0, 1, 117, 512, groups - 1]:
                first, last = int(offsets[original]), int(offsets[original + 1])
                mask = pre == np.uint64(base + original)
                np.testing.assert_array_equal(node_ids[targets[first:last]], post[mask])
                np.testing.assert_array_equal(weights[first:last], weight[mask])

    def test_non_integer_body_id_is_rejected(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("connectome_import_graph", SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with self.assertRaisesRegex(ValueError, "must be integer"):
            module._batch([123.4], [1.0], [1.0])


if __name__ == "__main__":
    unittest.main()
