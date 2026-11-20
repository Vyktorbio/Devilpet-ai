#!/usr/bin/env python3
"""Convert real connectome edge tables into a read-only, memory-mapped CSR graph.

Three bounded-memory passes using vectorized NumPy and compiled Numba scatter. The published graph is not merged with graphs from
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
    pre = np.asarray(pre)
    post = np.asarray(post)
    if not np.issubdtype(pre.dtype, np.integer) or not np.issubdtype(post.dtype, np.integer):
        raise ValueError("Body IDs must be integer values; float IDs can silently lose precision")
    if np.issubdtype(pre.dtype, np.signedinteger) and np.any(pre < 0):
        raise ValueError('Negative presynaptic body ID')
    if np.issubdtype(post.dtype, np.signedinteger) and np.any(post < 0):
        raise ValueError('Negative postsynaptic body ID')
    pre = pre.astype(np.uint64)
    post = post.astype(np.uint64)
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


def _indices(node_ids, ids):
    """Vectorized exact lookup; fail rather than silently change graph IDs."""
    indices = np.searchsorted(node_ids, ids)
    if np.any(indices >= len(node_ids)):
        raise ValueError("Source includes a body ID absent from the first pass")
    if np.any(node_ids[indices] != ids):
        raise ValueError("Source body IDs changed during import")
    return indices.astype(np.int64, copy=False)


def _scatter_jit():
    """Compile a single fast, deterministic CSR scatter kernel.

    The original Python loop over ~millions of per-batch source groups was the
    bottleneck for the real 1.1GB official Male CNS table.
    """
    try:
        from numba import njit
    except ImportError as exc:
        raise RuntimeError(
            "Real full-CNS imports require numba: pip install 'numba>=0.61,<1'"
        ) from exc

    @njit(cache=True)
    def scatter(cursor, pre_idx, post_idx, synapse_weights, targets, weights):
        for j in range(pre_idx.size):
            src = pre_idx[j]
            pos = cursor[src]
            targets[pos] = post_idx[j]
            weights[pos] = synapse_weights[j]
            cursor[src] = pos + 1

    return scatter


def _phase_progress(phase, processed, total):
    print(
        f"{phase}: {processed:,}" + (
            f" / {total:,} edges ({processed / total * 100:.1f}%)" if total else " edges"
        ),
        flush=True
    )


def build(args):
    if args.batch_size < 10 or args.batch_size > 2_000_000:
        raise ValueError("batch-size must be 10..2,000,000")
    inp = Path(args.edges).expanduser().resolve()
    out = Path(args.out).expanduser().resolve()
    if out.exists():
        raise FileExistsError(f"Destination already exists: {out}; old graphs are immutable")
    if not inp.is_file():
        raise FileNotFoundError(inp)
    if not args.dataset or not args.version or not args.source or not args.license:
        raise ValueError("Dataset ID, version, source and licence are mandatory")
    if args.nodes and not Path(args.nodes).expanduser().is_file():
        raise FileNotFoundError(args.nodes)
    out.parent.mkdir(parents=True, exist_ok=True)

    input_size = inp.stat().st_size
    input_mtime = inp.stat().st_mtime_ns
    columns = (args.pre, args.post, args.weight, args.batch_size)
    ids = np.empty(0, dtype=np.uint64)
    total_edges = 0
    report_at = 10_000_000

    # Pass 1: collect the union of all referenced body IDs. Every operation
    # runs inside compiled NumPy; no Python row-by-row or dict-by-body-ID loop.
    for pre, post, _ in iter_rows(inp, *columns):
        if not pre.size:
            continue
        ids = np.union1d(ids, np.unique(np.concatenate((pre, post))))
        total_edges += pre.size
        if args.max_edges and total_edges > args.max_edges:
            raise ValueError("Maximum allowed edge count exceeded")
        if total_edges >= report_at:
            _phase_progress("pass 1/3: neuron IDs", total_edges, 0)
            report_at += 10_000_000
    if args.nodes:
        annotation_ids = np.fromiter(
            iter_node_ids(Path(args.nodes).expanduser().resolve(),
                          args.node_column, args.batch_size),
            dtype=np.uint64
        )
        ids = np.union1d(ids, np.unique(annotation_ids))
    n = ids.size
    if n >= 2**32:
        raise ValueError("CSR format supports fewer than 2^32 body IDs")
    print(
        f"pass 1/3 finished: {n:,} body IDs; {total_edges:,} edge records",
        flush=True
    )
    if inp.stat().st_size != input_size or inp.stat().st_mtime_ns != input_mtime:
        raise ValueError("Input source changed after first pass")
    if total_edges > np.iinfo(np.uint64).max:
        raise ValueError("Too many edges for CSR offset type")

    # Pass 2: count outgoing degree by vectorized bincount (no dict iteration).
    degree = np.zeros(n, dtype=np.uint64)
    counted = 0
    report_at = 10_000_000
    for pre, post, _ in iter_rows(inp, *columns):
        pre_idx = _indices(ids, pre)
        _indices(ids, post)  # Reject changes to previously scanned body IDs.
        degree += np.bincount(pre_idx, minlength=n).astype(np.uint64)
        counted += pre.size
        if counted >= report_at:
            _phase_progress("pass 2/3: edge counts", counted, total_edges)
            report_at += 10_000_000
    if counted != total_edges:
        raise ValueError("Number of edges changed between passes")
    offsets = np.empty(n + 1, dtype=np.uint64)
    offsets[0] = 0
    np.cumsum(degree, out=offsets[1:])
    if int(offsets[-1]) != total_edges:
        raise ValueError("CSR offsets do not match the number of original edges")
    del degree

    tmp = Path(tempfile.mkdtemp(prefix="dcx-building-", dir=out.parent))
    targets = weights = None
    try:
        ids.astype("<u8", copy=False).tofile(tmp / "nodes.u64")
        offsets.astype("<u8", copy=False).tofile(tmp / "offsets.u64")

        # Use disk-backed output even when the source file exceeds RAM.
        if total_edges:
            targets = np.memmap(
                tmp / "targets.u32", dtype="<u4", mode="w+", shape=(total_edges,)
            )
            weights = np.memmap(
                tmp / "weights.f32", dtype="<f4", mode="w+", shape=(total_edges,)
            )
        else:
            (tmp / "targets.u32").write_bytes(b"")
            (tmp / "weights.f32").write_bytes(b"")
            targets = weights = None

        # Pass 3: only this compiled Numba loop touches individual edge
        # records. The order of edges *within each source ID* is preserved.
        cursor = offsets[:-1].copy()
        scatter = _scatter_jit() if total_edges else None
        inserted = 0
        report_at = 10_000_000
        for pre, post, w in iter_rows(inp, *columns):
            pre_idx = _indices(ids, pre)
            post_idx = _indices(ids, post)
            scatter(cursor, pre_idx, post_idx, w, targets, weights)
            inserted += pre.size
            if inserted >= report_at:
                _phase_progress("pass 3/3: edge scatter", inserted, total_edges)
                report_at += 10_000_000
        if inserted != total_edges or not np.array_equal(cursor, offsets[1:]):
            raise ValueError("Input changed or edge scatter positions did not match")
        if inp.stat().st_size != input_size or inp.stat().st_mtime_ns != input_mtime:
            raise ValueError("Input source changed during conversion")
        if targets is not None:
            targets.flush()
            weights.flush()
            del targets, weights

        meta = {
            "format": FORMAT,
            "dataset_id": args.dataset,
            "version": args.version,
            "source": args.source,
            "license": args.license,
            "node_count": int(n),
            "edge_count": int(total_edges),
            "node_scope": (
                "annotation-body-ids-plus-edge-endpoints" if args.nodes
                else "edge-endpoints-only"
            ),
            "edge_semantics": "synapse_count",
            "processing": (
                "Three-pass streaming NumPy/Numba CSR, all source records "
                "preserved without new filters, edge order preserved within "
                "source body ID, count weights stored as float32, no "
                "transmitter signs or physiological parameters inferred."
            ),
            "source_filename": inp.name,
            "node_source_filename": Path(args.nodes).name if args.nodes else None,
            "input_columns": {
                "pre": args.pre, "post": args.post, "weight": args.weight
            }
        }
        (tmp / "manifest.json").write_text(
            json.dumps(meta, indent=2) + "\n", encoding="utf8"
        )
        # All output is complete before it becomes visible as a dataset.
        os.replace(tmp, out)
        print(
            f"Created {out}: {n:,} body IDs, {total_edges:,} directed edge records",
            flush=True
        )
        print(
            "This is an anatomical graph, NOT a validated full-brain simulator.",
            flush=True
        )
    except BaseException:
        # Atomic output: never leave a seemingly valid partial dataset.
        shutil.rmtree(tmp, ignore_errors=True)
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
