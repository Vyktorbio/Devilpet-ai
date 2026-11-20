#!/usr/bin/env python3
"""Convert real connectome edge tables into a read-only, memory-mapped CSR graph.

Two bounded-memory passes. The published graph is not merged with graphs from
different specimens; use one dataset_id/version per output directory.
Full datasets can be larger than 1 GB: run on a PC/server with enough disk.
Requires numpy; Feather / Parquet also require pyarrow.
"""
from __future__ import annotations
import argparse
import csv
import gzip
import json
import math
import os
from pathlib import Path
import shutil
import tempfile

import numpy as np

FORMAT = "devilpet-connectome-csr-v1"


def _batch(pre, post, weight):
    pre = np.asarray(pre).astype(np.uint64)
    post = np.asarray(post).astype(np.uint64)
    weight = np.asarray(weight).astype(np.float64)
    if not (len(pre) == len(post) == len(weight)):
        raise ValueError("Column lengths differ")
    if not np.all(np.isfinite(weight)) or np.any(weight <= 0):
        raise ValueError("Every edge weight must be finite and positive; no silent filtering")
    if np.any(weight > np.finfo(np.float32).max):
        raise ValueError("Weight exceeds f32 range")
    return pre, post, weight.astype("<f4")


def iter_rows(path: Path, pre_col: str, post_col: str, weight_col: str, batch_size: int):
    suffix = path.suffix.lower()
    if suffix in {".csv", ".gz"}:
        reader = gzip.open if suffix == ".gz" else open
        with reader(path, "rt", encoding="utf8", newline="") as f:
            rows = csv.DictReader(f)
            if not rows.fieldnames or not {pre_col, post_col, weight_col}.issubset(rows.fieldnames):
                raise ValueError(f"Missing required CSV columns; got {rows.fieldnames}")
            pres, posts, weights = [], [], []
            for row in rows:
                # int() preserves large neuron body IDs exactly.
                p = int(row[pre_col])
                q = int(row[post_col])
                if p < 0 or q < 0:
                    raise ValueError("Negative neuron IDs are not supported")
                pres.append(p); posts.append(q); weights.append(float(row[weight_col]))
                if len(pres) >= batch_size:
                    yield _batch(pres, posts, weights)
                    pres, posts, weights = [], [], []
            if pres:
                yield _batch(pres, posts, weights)
    elif suffix in {".feather", ".arrow", ".ipc", ".parquet"}:
        try:
            import pyarrow as pa
            import pyarrow.parquet as pq
        except ImportError as exc:
            raise RuntimeError("Install pyarrow for Feather/Parquet imports") from exc
        cols = [pre_col, post_col, weight_col]
        if suffix == ".parquet":
            batches = pq.ParquetFile(path).iter_batches(batch_size=batch_size, columns=cols)
        else:
            source = pa.memory_map(str(path), "r")
            ipc = pa.ipc.open_file(source)
            # Feather V2 is an Arrow IPC file. Slice large record batches
            # so imports keep their memory bounded.
            def batches():
                for idx in range(ipc.num_record_batches):
                    b = ipc.get_batch(idx)
                    for offset in range(0, b.num_rows, batch_size):
                        yield b.slice(offset, batch_size).select(cols)
            batches = batches()
        for batch in batches:
            data = batch.to_pydict() if not hasattr(batch, "column") else None
            if data is not None:
                yield _batch(data[pre_col], data[post_col], data[weight_col])
            else:
                # IPC and Parquet may produce columns in differing orders.
                names = batch.schema.names
                yield _batch(*[batch.column(names.index(k)).to_numpy(zero_copy_only=False)
                               for k in cols])
    else:
        raise ValueError(f"Unsupported data format: {path.suffix}")


def iter_node_ids(path: Path, column: str, batch_size: int):
    suffix = path.suffix.lower()
    if suffix in {".csv", ".gz"}:
        reader = gzip.open if suffix == ".gz" else open
        with reader(path, "rt", encoding="utf8", newline="") as f:
            rows = csv.DictReader(f)
            if not rows.fieldnames or column not in rows.fieldnames:
                raise ValueError(f"Node column {column} not present")
            for row in rows:
                raw = row[column]
                if raw:
                    node = int(raw)
                    if node < 0: raise ValueError("Negative neuron ID")
                    yield node
    else:
        try:
            import pyarrow as pa
            import pyarrow.parquet as pq
        except ImportError as exc:
            raise RuntimeError("Install pyarrow for Feather/Parquet imports") from exc
        if suffix == ".parquet":
            batches = pq.ParquetFile(path).iter_batches(batch_size=batch_size,columns=[column])
        else:
            source = pa.memory_map(str(path),"r")
            ipc = pa.ipc.open_file(source)
            def batches():
                for i in range(ipc.num_record_batches):
                    b=ipc.get_batch(i)
                    for offset in range(0,b.num_rows,batch_size):
                        yield b.slice(offset,batch_size)
            batches=batches()
        for batch in batches:
            names=batch.schema.names
            values=batch.column(names.index(column)).to_pylist()
            for node in values:
                if node is None: continue
                n=int(node)
                if n<0: raise ValueError("Negative neuron ID")
                yield n


def build(args):
    if args.batch_size < 10 or args.batch_size > 2_000_000:
        raise ValueError("batch-size must be 10..2,000,000")
    inp = Path(args.edges).expanduser().resolve()
    out = Path(args.out).expanduser().resolve()
    if out.exists():
        raise FileExistsError(f"Destination already exists: {out}; old graphs are immutable")
    if not inp.is_file(): raise FileNotFoundError(inp)
    if not args.dataset or not args.version or not args.source or not args.license:
        raise ValueError("Dataset ID, version, source and licence are mandatory")
    out.parent.mkdir(parents=True,exist_ok=True)
    nodes = set()
    degrees = {}
    total_edges = 0
    columns = (args.pre,args.post,args.weight,args.batch_size)
    for pre, post, w in iter_rows(inp,*columns):
        if not len(pre): continue
        nodes.update(map(int,np.unique(pre)))
        nodes.update(map(int,np.unique(post)))
        u, counts=np.unique(pre,return_counts=True)
        for index,count in zip(u,counts):
            key=int(index)
            degrees[key]=degrees.get(key,0)+int(count)
        total_edges += len(pre)
        if args.max_edges and total_edges>args.max_edges:
            raise ValueError("Maximum allowed edge count exceeded; use a machine with more space")
    if args.nodes:
        for node in iter_node_ids(Path(args.nodes).expanduser().resolve(),args.node_column,args.batch_size):
            nodes.add(node)
    node_ids=np.array(sorted(nodes),dtype="<u8")
    n=len(node_ids)
    if n>=2**32: raise ValueError("This format supports fewer than 2^32 distinct neurons")
    offsets=np.zeros(n+1,dtype="<u8")
    for node,degree in degrees.items():
        idx=int(np.searchsorted(node_ids,node))
        offsets[idx+1]=degree
    np.cumsum(offsets,out=offsets)
    assert int(offsets[-1])==total_edges
    tmp=Path(tempfile.mkdtemp(prefix="dcx-building-",dir=out.parent))
    try:
        node_ids.tofile(tmp/"nodes.u64")
        offsets.tofile(tmp/"offsets.u64")
        # memmap creates bounded virtual-memory views without loading all edges.
        if total_edges:
            targets=np.memmap(tmp/"targets.u32",dtype="<u4",mode="w+",shape=(total_edges,))
            weights=np.memmap(tmp/"weights.f32",dtype="<f4",mode="w+",shape=(total_edges,))
        else:
            (tmp/"targets.u32").write_bytes(b"")
            (tmp/"weights.f32").write_bytes(b"")
            targets=weights=None
        cursor=offsets[:-1].copy()
        for pre,post,w in iter_rows(inp,*columns):
            if not len(pre):continue
            p=np.searchsorted(node_ids,pre).astype(np.uint32)
            q=np.searchsorted(node_ids,post).astype(np.uint32)
            if not np.array_equal(node_ids[p],pre) or not np.array_equal(node_ids[q],post):
                raise AssertionError("Neuron index conversion changed between passes")
            order=np.argsort(p,kind="stable")
            sorted_p=p[order]; sorted_q=q[order]; sorted_w=w[order]
            unique,starts,counts=np.unique(sorted_p,return_index=True,return_counts=True)
            for key,start,count in zip(unique,starts,counts):
                k=int(key);start=int(start);count=int(count)
                pos=int(cursor[k]);end=pos+count
                targets[pos:end]=sorted_q[start:start+count]
                weights[pos:end]=sorted_w[start:start+count]
                cursor[k]=end
        if not np.array_equal(cursor,offsets[1:]):
            raise AssertionError("CSR positions do not match expected degree counts")
        if targets is not None:
            targets.flush();weights.flush()
            del targets,weights
        meta={
            "format":FORMAT,"dataset_id":args.dataset,"version":args.version,
            "source":args.source,"license":args.license,
            "node_count":n,"edge_count":total_edges,
            "node_scope":"all-annotated-neurons" if args.nodes else "edge-endpoints-only",
            "edge_semantics":"synapse_count",
            "processing":"Two-pass exact adjacency import; no dropped edges or weight threshold. Duplicate records preserved; positive synapse counts converted to float32. No neurotransmitter signs inferred.",
            "source_filename":inp.name,
            "node_source_filename":Path(args.nodes).name if args.nodes else None,
            "input_columns":{"pre":args.pre,"post":args.post,"weight":args.weight}
        }
        (tmp/"manifest.json").write_text(json.dumps(meta,indent=2)+"\n",encoding="utf8")
        os.replace(tmp,out)
        print(f"Created {out}: {n:,} neurons, {total_edges:,} edge records")
        print("No biological neural activity inferred; this is a structural CSR graph.")
    except BaseException:
        shutil.rmtree(tmp,ignore_errors=True)
        raise


def main():
    p=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--edges",required=True,help="Official CSV(.gz), Feather or Parquet edge list")
    p.add_argument("--nodes",help="Optional annotation table to include isolated neurons")
    p.add_argument("--node-column",default="bodyId")
    p.add_argument("--pre",default="body_pre")
    p.add_argument("--post",default="body_post")
    p.add_argument("--weight",default="weight")
    p.add_argument("--dataset",required=True,help="Pinned dataset identity (e.g. male-cns-v1.0-2026)")
    p.add_argument("--version",required=True)
    p.add_argument("--source",required=True,help="Canonical paper/data URL")
    p.add_argument("--license",required=True)
    p.add_argument("--out",required=True)
    p.add_argument("--batch-size",type=int,default=100_000)
    p.add_argument("--max-edges",type=int,default=0)
    build(p.parse_args())


if __name__=="__main__":
    main()
