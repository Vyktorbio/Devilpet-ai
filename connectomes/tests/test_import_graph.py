"""Unit tests use **synthetic fixtures only**. They never claim real connectome data."""
from __future__ import annotations
import csv
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import numpy as np

SCRIPT=Path(__file__).resolve().parents[1]/"import_graph.py"
class ConnectomeImporterTests(unittest.TestCase):
    def test_preserves_all_edges_and_neuron_ids(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            edges=root/"edges.csv"
            nodes=root/"nodes.csv"
            with edges.open("w",newline="") as f:
                w=csv.writer(f);w.writerow(["body_pre","body_post","weight"])
                w.writerows([(100,200,5),(100,300,2),(200,300,8),(200,300,1),(300,100,4)])
            with nodes.open("w",newline="") as f:
                w=csv.writer(f);w.writerow(["bodyId"]);w.writerows([(100,),(200,),(300,),(400,)])
            out=root/"graph"
            subprocess.run([sys.executable,str(SCRIPT),
                "--edges",str(edges),"--nodes",str(nodes),
                "--dataset","fixture-synthetic","--version","test-1",
                "--source","synthetic://unit-test","--license","test-fixture",
                "--out",str(out),"--batch-size","10"],check=True)
            meta=json.loads((out/"manifest.json").read_text())
            self.assertEqual(meta["node_count"],4)
            self.assertEqual(meta["edge_count"],5)
            self.assertEqual(meta["node_scope"],"all-annotated-neurons")
            np.testing.assert_array_equal(np.fromfile(out/"nodes.u64",dtype="<u8"),[100,200,300,400])
            np.testing.assert_array_equal(np.fromfile(out/"offsets.u64",dtype="<u8"),[0,2,4,5,5])
            np.testing.assert_array_equal(np.fromfile(out/"targets.u32",dtype="<u4"),[1,2,2,2,0])
            np.testing.assert_array_equal(np.fromfile(out/"weights.f32",dtype="<f4"),[5,2,8,1,4])
    def test_rejects_invalid_weights_without_partial_output(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            (root/"bad.csv").write_text("body_pre,body_post,weight\n1,2,-5\n")
            out=root/"rejected"
            result=subprocess.run([sys.executable,str(SCRIPT),
                "--edges",str(root/"bad.csv"),
                "--dataset","fixture-synthetic","--version","test-1",
                "--source","synthetic://test","--license","test-fixture",
                "--out",str(out)],capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            self.assertFalse(out.exists())
    def test_does_not_overwrite_existing_graph(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);out=root/"graph";out.mkdir()
            (out/"important.txt").write_text("original")
            (root/"edges.csv").write_text("body_pre,body_post,weight\n1,2,3\n")
            result=subprocess.run([sys.executable,str(SCRIPT),
                "--edges",str(root/"edges.csv"),
                "--dataset","fixture-synthetic","--version","test-1",
                "--source","synthetic://test","--license","test-fixture",
                "--out",str(out)],capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            self.assertEqual((out/"important.txt").read_text(),"original")

if __name__=="__main__":
    unittest.main()
