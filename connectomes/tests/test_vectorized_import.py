"""Regression tests for the vectorized whole-CNS import pipeline.

These files are synthetic fixtures only, not real Drosophila data.
"""
import collections
import csv
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import numpy as np

IMPORT = Path(__file__).resolve().parents[1]/"import_graph.py"


class VectorizedGraphTests(unittest.TestCase):
    def _run(self, edges, annotations=None, batch_size=13):
        work = Path(self.temp.name)
        src = work/"records.csv"
        with src.open("w", newline="") as out:
            writer = csv.writer(out)
            writer.writerow(("body_pre","body_post","weight"))
            writer.writerows(edges)
        nodes = work/"annotations.csv"
        if annotations is not None:
            with nodes.open("w",newline="") as out:
                writer=csv.writer(out)
                writer.writerow(["bodyId"])
                writer.writerows((x,) for x in annotations)
        result=work/"graph"
        cmd = [sys.executable,str(IMPORT),
               "--edges",str(src),"--dataset","synthetic-multibatch",
               "--version","1","--source","synthetic://regression",
               "--license","test-only","--batch-size",str(batch_size),
               "--out",str(result)]
        if annotations is not None:
            cmd+=["--nodes",str(nodes)]
        completed=subprocess.run(cmd,capture_output=True,text=True)
        return completed,result

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)

    def test_duplicate_edges_revisited_across_batches_preserved_exactly(self):
        ids=[2**53+103, 2**53+304, 2**53+707, 2**53+1109]
        edges=[]
        for i in range(153):
            pre=ids[(i*7)%3]
            post=ids[(i*13+1)%4]
            edges.append((pre,post,1+(i%29)))
        edges.extend([(ids[0],ids[1],2),(ids[0],ids[1],2)])
        proc,out=self._run(edges,annotations=ids,batch_size=13)
        self.assertEqual(proc.returncode,0,proc.stderr)
        meta=json.loads((out/"manifest.json").read_text())
        self.assertEqual(meta["node_count"],4)
        self.assertEqual(meta["edge_count"],len(edges))
        np.testing.assert_array_equal(np.fromfile(out/"nodes.u64",dtype="<u8"),ids)
        offsets=np.fromfile(out/"offsets.u64",dtype="<u8")
        targets=np.fromfile(out/"targets.u32",dtype="<u4")
        weights=np.fromfile(out/"weights.f32",dtype="<f4")
        actual=[]
        for i in range(len(ids)):
            for j in range(int(offsets[i]),int(offsets[i+1])):
                actual.append((ids[i],ids[int(targets[j])],int(weights[j])))
        self.assertEqual(collections.Counter(actual),collections.Counter(edges))
        self.assertIn("complete and atomically installed",proc.stdout)

    def test_no_edges_with_annotated_neurons_creates_empty_valid_csr(self):
        proc,out=self._run([],annotations=[1,2,3],batch_size=10)
        self.assertEqual(proc.returncode,0,proc.stderr)
        self.assertEqual((out/"targets.u32").stat().st_size,0)
        self.assertEqual((out/"weights.f32").stat().st_size,0)
        np.testing.assert_array_equal(np.fromfile(out/"offsets.u64",dtype="<u8"),[0,0,0,0])
        self.assertEqual(json.loads((out/"manifest.json").read_text())["node_count"],3)

    def test_invalid_and_out_of_range_body_ids_fail_atomic_import(self):
        for bad in [(-1,2,1),(2**64,2,1)]:
            with self.subTest(bad=bad):
                proc,out=self._run([bad],batch_size=10)
                self.assertNotEqual(proc.returncode,0)
                self.assertFalse(out.exists())

    def test_third_pass_small_batches_match_directed_input(self):
        rng=np.random.default_rng(4872)
        edges=[(int(a),int(b),int(w))
               for a,b,w in zip(rng.integers(1,1000,size=1100),
                                rng.integers(1,1000,size=1100),
                                rng.integers(1,1000,size=1100))]
        proc,out=self._run(edges,batch_size=10)
        self.assertEqual(proc.returncode,0,proc.stderr)
        nodeids=np.fromfile(out/"nodes.u64",dtype="<u8")
        offsets=np.fromfile(out/"offsets.u64",dtype="<u8")
        targets=np.fromfile(out/"targets.u32",dtype="<u4")
        weights=np.fromfile(out/"weights.f32",dtype="<f4")
        observed=collections.Counter(
            (int(nodeids[src]),int(nodeids[targets[pos]]),int(weights[pos]))
            for src in range(len(nodeids))
            for pos in range(int(offsets[src]),int(offsets[src+1]))
        )
        self.assertEqual(observed,collections.Counter(edges))


if __name__ == "__main__":
    unittest.main()
