"""Inspect full real CNS CSR graphs in Python without loading them into RAM."""
from __future__ import annotations
import argparse
from connectome_engine import ConnectomeGraph, ConnectomeController


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)
    inspect = sub.add_parser("inspect")
    inspect.add_argument("graph")
    neighbors = sub.add_parser("neighbors")
    neighbors.add_argument("graph")
    neighbors.add_argument("body_id", type=int)
    neighbors.add_argument("--top", type=int, default=20)
    pulse = sub.add_parser("pulse")
    pulse.add_argument("graph")
    pulse.add_argument("ports", help="Reviewed source-backed sensory/motor neurons")
    pulse.add_argument("--sensor", default="odor_left")
    pulse.add_argument("--hops", type=int, default=3)
    args = p.parse_args()
    graph = ConnectomeGraph(args.graph)
    if args.command == "inspect":
        print(f"Dataset: {graph.manifest['dataset_id']} ({graph.manifest['version']})")
        print(f"Source: {graph.manifest['source']}")
        print(f"Body IDs: {graph.node_count:,}; directed edges: {graph.edge_count:,}")
        print("This is an anatomical graph, not a validated neural simulation.")
    elif args.command == "neighbors":
        idx = graph.index_of(args.body_id)
        targets, weights = graph.outgoing(idx)
        ranked = weights.argsort()[::-1]
        for i in ranked[:max(0, min(1000, args.top))]:
            print(f"{args.body_id} -> {int(graph.nodes[targets[i]])}: {float(weights[i])} synapses")
    else:
        controller = ConnectomeController(graph, args.ports)
        print(controller.step({args.sensor: 1.}, hops=args.hops))
        print("Unsigned experimental propagation; not biological fly behavior.")


if __name__ == "__main__":
    main()
