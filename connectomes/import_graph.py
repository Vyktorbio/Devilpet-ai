#!/usr/bin/env python3
"""Versioned, bounded-memory conversion of published connectome edge lists to CSR.

Three vectorized streaming passes:
1. Collect unique original pre/post IDs and count records.
2. Count each source degree using numpy.bincount.
3. Fill targets and weights using contiguous-key stable sorting and vectorized
   disk-backed index writes (NO Python loop per neuron or edge group).

No connectivity is invented or dropped; duplicate edge records remain distinct.
The result represents anatomical connectivity, NOT functioning neuronal dynamics.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import json
import os
from pathlib import Path
import shutil
import tempfile
import time

import numpy as np

FORMAT = "devilpet-connectome-csr-v1"
MAX_U64 = np.iinfo(np.uint64).max
MAX_F32 = np.finfo(np.float32).max


def _ids(values, name: str):
    arr = np.asarray(values)
    if arr.dtype.kind not in "iu":
        if arr.dtype.kind == "O":
            vals = []
            for x in arr:
                if isinstance(x, (bool, float)) or not isinstance(x, (int, np.integer)):
                    raise ValueError(f"{name} contains a non-integer ID")
                if x < 0 or x > MAX_U64:
                    raise ValueError(f"{name} contains ID outside uint64 range")
                vals.append(x)
            return np.asarray(vals, dtype=np.uint64)
        raise ValueError(f"{name} contains non-integer body IDs ({arr.dtype})")
    if arr.dtype.kind == "i" and np.any(arr < 0):
        raise ValueError(f"{name} contains negative body IDs")
    return arr.astype("<u8", copy=False)


def _batch(pre, post, weight):
    pre = _ids(pre, "pre")
    post = _ids(post, "post")
    weight = np.asarray(weight).astype(np.float64)
    if not (len(pre) == len(post) == len(weight)):
        raise ValueError("Column lengths differ")
    if not np.all(np.isfinite(weight)) or np.any(weight <= 0) or np.any(weight > MAX_F32):
        raise ValueError("Weight must be finite, positive and representable as float32")
    return pre, post, weight.astype("<f4")


def iter_rows(path: Path, pre_col: str, post_col: str, weight_col: str,
              batch_size: int):
    suffix = path.suffix.lower()
    cols = [pre_col, post_col, weight_col]
    if len(set(cols)) != 3:
        raise ValueError("Pre, post, weight columns must be distinct")
    if suffix in (".csv", ".gz"):
        opener = gzip.open if suffix == ".gz" else open
        with opener(path, "rt", encoding="utf8", newline="") as handle:
            reader = csv.DictReader(handle)
            if not reader.fieldnames or not set(cols).issubset(reader.fieldnames):
                raise ValueError(f"Missing columns; got {reader.fieldnames}")
            pre, post, w = [], [], []
            for row in reader:
                a, b = int(row[pre_col]), int(row[post_col])
                if a < 0 or b < 0 or a > MAX_U64 or b > MAX_U64:
                    raise ValueError("Body ID outside uint64 range")
                pre.append(a)
                post.append(b)
                w.append(float(row[weight_col]))
                if len(pre) >= batch_size:
                    yield _batch(pre, post, w)
                    pre, post, w = [], [], []
            if pre:
                yield _batch(pre, post, w)
        return

    if suffix not in (".feather", ".ipc", ".arrow", ".parquet"):
        raise ValueError(f"Unsupported edge table extension {suffix}")
    try:
        import pyarrow as pa
        import pyarrow.parquet as pq
    except ImportError as exc:
        raise RuntimeError("Install pyarrow for Feather/Parquet") from exc

    def convert(batch):
        names = batch.schema.names
        if not set(cols).issubset(names):
            raise ValueError(f"Missing columns; got {names}")
        return _batch(*(batch.column(names.index(k)).to_numpy(zero_copy_only=False)
                        for k in cols))

    if suffix == ".parquet":
        file = pq.ParquetFile(path)
        for batch in file.iter_batches(batch_size=batch_size, columns=cols):
            yield convert(batch)
    else:
        # Reader owns a mapped file, so record batch metadata never loads the
        # complete 1+ GB graph. Slice batches after decoding a record batch.
        with pa.memory_map(str(path), "r") as source:
            ipc = pa.ipc.open_file(source)
            if not set(cols).issubset(ipc.schema.names):
                raise ValueError(f"Missing columns; got {ipc.schema.names}")
            for idx in range(ipc.num_record_batches):
                raw = ipc.get_batch(idx).select(cols)
                for offset in range(0, raw.num_rows, batch_size):
                    yield convert(raw.slice(offset, batch_size))


def iter_node_ids(path: Path, column: str, batch_size: int):
    suffix = path.suffix.lower()
    if suffix in (".csv", ".gz"):
        opener = gzip.open if suffix == ".gz" else open
        with opener(path, "rt", encoding="utf8", newline="") as handle:
            reader = csv.DictReader(handle)
            if not reader.fieldnames or column not in reader.fieldnames:
                raise ValueError(f"Node column {column} not found")
            for row in reader:
                raw = row[column]
                if raw not in ("", None):
                    n = int(raw)
                    if n < 0 or n > MAX_U64:
                        raise ValueError("Node ID outside uint64 range")
                    yield n
        return
    if suffix not in (".feather", ".arrow", ".ipc", ".parquet"):
        raise ValueError(f"Unsupported annotation extension {suffix}")
    try:
        import pyarrow as pa
        import pyarrow.parquet as pq
    except ImportError as exc:
        raise RuntimeError("Install pyarrow for annotations") from exc

    def emit(batch):
        if column not in batch.schema.names:
            raise ValueError(f"Node column {column} missing")
        for v in batch.column(batch.schema.names.index(column)).to_pylist():
            if v is not None:
                if not isinstance(v, int) or v < 0 or v > MAX_U64:
                    raise ValueError("Invalid annotation neuron/segment ID")
                yield v

    if suffix == ".parquet":
        for batch in pq.ParquetFile(path).iter_batches(batch_size=batch_size,
                                                        columns=[column]):
            yield from emit(batch)
    else:
        with pa.memory_map(str(path), "r") as source:
            ipc = pa.ipc.open_file(source)
            if column not in ipc.schema.names:
                raise ValueError(f"Node column {column} missing")
            for i in range(ipc.num_record_batches):
                batch = ipc.get_batch(i).select([column])
                for start in range(0, batch.num_rows, batch_size):
                    yield from emit(batch.slice(start, batch_size))


def _progress(stage, total, t0):
    print(f"[{stage}] {total:,} edge records, {time.monotonic()-t0:.1f}s elapsed",
          flush=True)


def build(args):
    if not (10 <= args.batch_size <= 2_000_000):
        raise ValueError("batch-size must be within 10..2,000,000")
    inp = Path(args.edges).expanduser().resolve()
    out = Path(args.out).expanduser().resolve()
    if out.exists():
        raise FileExistsError(f"Destination already exists: {out}; existing data are immutable")
    if not inp.is_file():
        raise FileNotFoundError(inp)
    if not all((args.dataset, args.version, args.source, args.license)):
        raise ValueError("Dataset, version, source and license are required")

    columns = (args.pre, args.post, args.weight, args.batch_size)
    t0 = time.monotonic()
    total_edges = 0
    # No Python per-neuron or per-edge loop across a 150+ million edge dataset.
    nodes = np.empty(0, dtype="<u8")
    last_report = 0
    for pre, post, _ in iter_rows(inp, *columns):
        total_edges += len(pre)
        if args.max_edges and total_edges > args.max_edges:
            raise ValueError("max-edges exceeded")
        # The union is sorted unique; original uint64 IDs retain all bits.
        candidate = np.unique(np.concatenate((pre, post)))
        nodes = np.union1d(nodes, candidate)
        if total_edges - last_report >= 10_000_000:
            _progress("unique neuron/segment IDs", total_edges, t0)
            last_report = total_edges

    if args.nodes:
        annotated = set(iter_node_ids(Path(args.nodes).expanduser().resolve(),
                                      args.node_column, args.batch_size))
        if annotated:
            nodes = np.union1d(nodes, np.fromiter(annotated, dtype="<u8",
                                                     count=len(annotated)))
    n = len(nodes)
    if n >= 2**32:
        raise ValueError("CSR targets use uint32: too many distinct IDs")
    if total_edges == 0 and n == 0:
        raise ValueError("Empty graph has no nodes; check source table")
    _progress(f"IDs resolved: {n:,} unique body IDs", total_edges, t0)

    # Phase 2: count degrees vectorially after IDs have been fully resolved.
    degrees = np.zeros(n, dtype="<u8")
    counted = 0
    for pre, _, _ in iter_rows(inp, *columns):
        if not len(pre):
            continue
        p = np.searchsorted(nodes, pre).astype(np.uint32)
        if not np.array_equal(nodes[p], pre):
            raise ValueError("Unresolved presynaptic ID in second pass")
        degrees += np.bincount(p, minlength=n).astype("<u8")
        counted += len(pre)
    if counted != total_edges:
        raise ValueError("Source changed between graph scans")
    offsets = np.empty(n+1, dtype="<u8")
    offsets[0] = 0
    np.cumsum(degrees, out=offsets[1:])
    if int(offsets[-1]) != total_edges:
        raise ValueError("Edge counts do not match CSR offsets")
    _progress("degrees and offsets", counted, t0)

    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix="dcx-building-", dir=out.parent))
    try:
        nodes.tofile(tmp/"nodes.u64")
        offsets.tofile(tmp/"offsets.u64")
        if total_edges:
            targets = np.memmap(tmp/"targets.u32", dtype="<u4", mode="w+",
                                shape=(total_edges,))
            weights = np.memmap(tmp/"weights.f32", dtype="<f4", mode="w+",
                                shape=(total_edges,))
        else:
            (tmp/"targets.u32").write_bytes(b"")
            (tmp/"weights.f32").write_bytes(b"")
            targets = weights = None
        cursor = offsets[:-1].copy()
        copied, last_report = 0, 0
        for pre, post, w in iter_rows(inp, *columns):
            if not len(pre):
                continue
            p = np.searchsorted(nodes, pre).astype(np.uint32)
            q = np.searchsorted(nodes, post).astype(np.uint32)
            if not np.array_equal(nodes[p], pre) or not np.array_equal(nodes[q], post):
                raise ValueError("Source changed or missing IDs in third pass")

            # Stable sorting guarantees no duplicate edges disappear.
            order = np.argsort(p, kind="stable")
            sorted_p, sorted_q = p[order], q[order]
            sorted_w = w[order]
            unique, starts, counts = np.unique(
                sorted_p, return_index=True, return_counts=True
            )
            # Vectorized per-group offsets avoid the original (enormous)
            # Python loop for each source neuron in every record batch.
            local = (np.arange(len(p), dtype="<u8") -
                     np.repeat(starts.astype("<u8"), counts))
            positions = cursor[sorted_p] + local
            if np.any(positions >= offsets[sorted_p + 1]):
                raise ValueError("Edge write exceeded source CSR segment")
            targets[positions] = sorted_q
            weights[positions] = sorted_w
            cursor[unique] += counts.astype("<u8")
            copied += len(pre)
            if copied - last_report >= 10_000_000:
                _progress("writing directed CSR edges", copied, t0)
                last_report = copied
        if copied != total_edges or not np.array_equal(cursor, offsets[1:]):
            raise ValueError("Incomplete CSR write or source table changed")
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
            "node_count": n,
            "edge_count": total_edges,
            "node_scope": ("annotation-body-ids-plus-edge-endpoints" if args.nodes
                           else "edge-endpoints-only"),
            "edge_semantics": "synapse_count",
            "processing": (
                "Three vectorized, streaming passes; all directed edge records "
                "retained, including duplicate pre/post records; weight converted "
                "to float32. Body IDs include non-neuronal segments; transmitter "
                "signs and physiological activity are not inferred."
            ),
            "source_filename": inp.name,
            "node_source_filename": Path(args.nodes).name if args.nodes else None,
            "input_columns": {"pre": args.pre, "post": args.post, "weight": args.weight},
        }
        (tmp/"manifest.json").write_text(json.dumps(meta, indent=2)+"\n",
                                          encoding="utf8")
        os.replace(tmp, out)
        _progress("complete and atomically installed", copied, t0)
        print(f"Created {out}: {n:,} body IDs and {total_edges:,} edge records", flush=True)
    except BaseException:
        if targets is not None:
            del targets
        if weights is not None:
            del weights
        shutil.rmtree(tmp, ignore_errors=True)
        raise


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--edges", required=True)
    p.add_argument("--nodes", help="Optional annotation table, including isolated body IDs")
    p.add_argument("--node-column", default="bodyId")
    p.add_argument("--pre", default="body_pre")
    p.add_argument("--post", default="body_post")
    p.add_argument("--weight", default="weight")
    p.add_argument("--dataset", required=True)
    p.add_argument("--version", required=True)
    p.add_argument("--source", required=True)
    p.add_argument("--license", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--batch-size", type=int, default=500_000)
    p.add_argument("--max-edges", type=int, default=0)
    build(p.parse_args())


if __name__ == "__main__":
    main()
