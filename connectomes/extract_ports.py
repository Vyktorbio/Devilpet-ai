#!/usr/bin/env python3
"""Review real 2026 connectome neuron annotations before binding sensors/motors.

Outputs candidate rows with original IDs and evidence columns, NOT automatic
motor assignments. Identifying a motor neuron does not establish its
left/right wing role or that its activation yields an actuation direction.
"""
import argparse
import csv
import hashlib
import json
from pathlib import Path

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--annotations",required=True,help="Official Arrow Feather/Parquet or CSV")
    p.add_argument("--out",required=True,help="Candidate review CSV")
    p.add_argument("--id-column",default="bodyId")
    args=p.parse_args()
    path=Path(args.annotations)
    if not path.is_file():raise FileNotFoundError(path)
    suffix=path.suffix.lower()
    if suffix==".parquet":
        import pyarrow.parquet as pq
        table=pq.read_table(path)
    elif suffix in (".feather",".ipc",".arrow"):
        import pyarrow.feather as feather
        table=feather.read_table(path)
    elif suffix==".csv":
        import pyarrow.csv as csv_arrow
        table=csv_arrow.read_csv(path)
    else:
        raise ValueError("Expected official Feather, Parquet or CSV")
    columns=table.column_names
    if args.id_column not in columns:
        raise ValueError(f"Neuron identifier column {args.id_column!r} not found: {columns}")
    identity=["superclass","class","subclass","type","instance","receptorType",
              "entryNerve","exitNerve","somaSide","status","somaNeuromere"]
    keys=[args.id_column]+[c for c in identity if c in columns]
    data={col:table.column(col).to_pylist() for col in keys}
    destinations=Path(args.out)
    destinations.parent.mkdir(parents=True,exist_ok=True)
    sha=hashlib.sha256()
    with path.open("rb") as f:
        for part in iter(lambda:f.read(4*1024*1024),b""):sha.update(part)
    counts={"candidate_sensory":0,"candidate_motor":0,"total_rows":table.num_rows}
    with destinations.open("w",newline="",encoding="utf-8") as f:
        writer=csv.DictWriter(f,fieldnames=["proposed_superclass","candidate_only"]+keys)
        writer.writeheader()
        for i in range(table.num_rows):
            labels=" ".join(str(data[col][i] or "") for col in keys[1:]).lower()
            role=None
            if any(x in labels for x in ("sensory","afferent","photoreceptor","olfactory","gustatory","mechanosensory")):
                role="sensory"
            elif any(x in labels for x in ("motor","efferent","motoneuron")):
                role="motor"
            if role is None:continue
            counts["candidate_"+role]+=1
            writer.writerow({
                "proposed_superclass":role,"candidate_only":True,
                **{key:data[key][i] for key in keys}
            })
    result={
        "source":str(path.name),"source_sha256":sha.hexdigest(),
        "columns_available":columns,
        "counts":counts,
        "status":"ANNOTATION_CANDIDATES_ONLY — REVIEW REQUIRED BEFORE LIVE BODY CONTROL",
        "warning":"do not infer left/right turn, lift, feeding or wing direction from superclass alone"
    }
    destinations.with_suffix(".provenance.json").write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps(result,indent=2))

if __name__=="__main__":
    main()
