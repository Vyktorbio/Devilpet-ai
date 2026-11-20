"""Large, synthetic regression for the published-connectome CSR importer.

The official Male CNS data are NOT included in this fixture. Exact 64-bit body
IDs, duplicate rows and all original directed edges must survive conversion.
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


class FullScaleImportRegressions(unittest.TestCase):
    def test_one_million_interleaved_directed_edges_are_lossless(self):
        try:
            import pyarrow as pa
            import pyarrow.feather as feather
        except ImportError:
            self.skipTest("pyarrow unavailable")

        size, kinds = 1_000_000, 1201
        base = np.uint64(9_007_199_254_740_993)  # above JS safe integer
        seq = np.arange(size, dtype=np.uint64)
        pre = base + ((seq * 13 + 17) % kinds)
        post = base + ((seq * 31 + 21) % kinds)
        counts = ((seq * 7) % 47 + 1).astype(np.int64)
        # Include repeated pairs, and deliberately interleave source neurons.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            feather.write_feather(
                pa.table({"body_pre": pre, "body_post": post, "weight": counts}),
                root / "edges.feather", chunksize=25_000
            )
            completed = subprocess.run([
                sys.executable, "-u", str(SCRIPT),
                "--edges", str(root / "edges.feather"),
                "--dataset", "synthetic-regression-only",
                "--version", "test-1", "--source", "synthetic://csr",
                "--license", "fixture", "--out", str(root / "csr"),
                "--batch-size", "50000"
            ], capture_output=True, text=True, timeout=120)
            self.assertEqual(completed.returncode, 0,
                             completed.stdout + "\n" + completed.stderr)
            out = root / "csr"
            metadata = json.loads((out / "manifest.json").read_text())
            self.assertEqual(metadata["edge_count"], size)
            self.assertEqual(metadata["node_count"], kinds)
            nodes = np.fromfile(out / "nodes.u64", dtype="<u8")
            offsets = np.fromfile(out / "offsets.u64", dtype="<u8")
            targets = np.fromfile(out / "targets.u32", dtype="<u4")
            weights = np.fromfile(out / "weights.f32", dtype="<f4")
            np.testing.assert_array_equal(nodes, base + np.arange(kinds, dtype=np.uint64))
            self.assertEqual(int(offsets[-1]), size)
            np.testing.assert_array_equal(
                np.diff(offsets),
                np.bincount(np.searchsorted(nodes, pre), minlength=kinds)
            )
            # Check ALL one million directed target IDs and synapse counts in
            # original order within each source vertex.
            expected_order = np.argsort(pre, kind="stable")
            np.testing.assert_array_equal(nodes[targets], post[expected_order])
            np.testing.assert_array_equal(weights, counts[expected_order])

    def test_nonintegral_body_ids_rejected(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("connectome_importer", SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with self.assertRaisesRegex(ValueError, "non-integer"):
            module._batch([1.5], [2.0], [1.0])


if __name__ == "__main__":
    unittest.main()
