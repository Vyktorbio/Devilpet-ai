"""Local Python HTTP controller for a real, version-pinned CNS graph.

Start only with an original compiled CSR graph and reviewed neuron IDs.
The server is loopback-only. GitHub Pages hosts ONLY the visualization.
This is unsigned experimental propagation, not validated fly physiology.
"""
from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from urllib.parse import urlsplit

from connectome_engine import ConnectomeController, ConnectomeError, ConnectomeGraph

ALLOWED_ORIGINS = frozenset({
    "https://vyktorbio.github.io",
    "http://localhost:8137",
    "http://127.0.0.1:8137",
    "http://localhost:8138",
    "http://127.0.0.1:8138",
})
MAX_REQUEST_BYTES = 16384


def make_server(graph: ConnectomeGraph, controller: ConnectomeController,
                host: str = "127.0.0.1", port: int = 8326):
    if host not in ("127.0.0.1", "localhost", "::1"):
        raise ValueError("Refusing public bind; use authenticated HTTPS proxy")
    manifest = graph.manifest
    health = {
        "schema": "devilpet-cns-server-v1",
        "status": "graph_loaded_ports_reviewed",
        "backend": "python",
        "dataset_id": manifest["dataset_id"],
        "dataset_version": manifest["version"],
        "dataset_source": manifest["source"],
        "license": manifest["license"],
        "node_count": graph.node_count,
        "edge_count": graph.edge_count,
        "port_map_reviewed_by": controller.ports["reviewed_by"],
        "available_sensors": sorted(controller.sensors),
        "available_motors": sorted(controller.motors),
        "controller_semantics": "unsigned-anatomical-experimental-not-validated-physiology",
        "full_cns_assigned": False,
    }

    class Handler(BaseHTTPRequestHandler):
        server_version = "DevilPetPythonCNS/1.0"

        def _origin(self):
            origin = self.headers.get("Origin")
            if origin is not None and origin not in ALLOWED_ORIGINS:
                raise ConnectomeError("Origin not allowed")
            return origin

        def _json(self, status, payload, origin=None):
            data = json.dumps(payload, allow_nan=False, separators=(",", ":")).encode("utf8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            if origin:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self):
            try:
                origin = self._origin()
            except ConnectomeError:
                self._json(403, {"error": "forbidden", "reason": "Origin not allowed"})
                return
            self._json(200, {}, origin)

        def do_GET(self):
            try:
                origin = self._origin()
            except ConnectomeError:
                self._json(403, {"error": "forbidden", "reason": "Origin not allowed"})
                return
            if urlsplit(self.path).path == "/health":
                self._json(200, health, origin)
            else:
                self._json(404, {"error": "not_found"}, origin)

        def do_POST(self):
            try:
                origin = self._origin()
            except ConnectomeError:
                self._json(403, {"error": "forbidden", "reason": "Origin not allowed"})
                return
            if urlsplit(self.path).path != "/step":
                self._json(404, {"error": "not_found"}, origin)
                return
            try:
                if not self.headers.get("Content-Type", "").split(";")[0].strip().lower() == "application/json":
                    raise ConnectomeError("Expected application/json")
                length = int(self.headers.get("Content-Length", "-1"))
                if not 0 < length <= MAX_REQUEST_BYTES:
                    raise ConnectomeError("JSON request size out of bounds")
                raw = self.rfile.read(length)
                if len(raw) != length:
                    raise ConnectomeError("Incomplete request body")
                def reject_non_json_constant(value):
                    raise ConnectomeError(f"Invalid JSON number: {value}")
                body = json.loads(raw, parse_constant=reject_non_json_constant)
                if not isinstance(body, dict) or not isinstance(body.get("channels"), dict):
                    raise ConnectomeError("Missing sensor channels")
                sample_id = body.get("sample_id", 0)
                if isinstance(sample_id, bool) or not isinstance(sample_id, int) or \
                   not 0 <= sample_id <= 2**53 - 1:
                    raise ConnectomeError("Invalid sample_id")
                motor = controller.step(body["channels"], body.get("hops", 3))
                payload = {
                    "schema": "devilpet-cns-output-v1",
                    "sample_id": sample_id,
                    "dataset_id": manifest["dataset_id"],
                    "dataset_version": manifest["version"],
                    "motor": motor,
                    "controller_semantics": "experimental-anatomical-unsigned",
                }
                self._json(200, payload, origin)
            except (ConnectomeError, ValueError, TypeError, UnicodeDecodeError) as exc:
                self._json(422, {"error": "invalid_request", "reason": str(exc)}, origin)

    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--graph", type=Path, required=True,
                        help="Compiled CSR directory from connectomes/import_graph.py")
    parser.add_argument("--ports", type=Path, required=True,
                        help="Reviewed official neuron ID mapping JSON (never fabricate IDs)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8326)
    args = parser.parse_args()
    graph = ConnectomeGraph(args.graph)
    controller = ConnectomeController(graph, args.ports)
    server = make_server(graph, controller, args.host, args.port)
    print(f"Python CNS service listening at http://{args.host}:{server.server_port}", flush=True)
    print(f"Original dataset: {graph.manifest['dataset_id']} v{graph.manifest['version']}; "
          f"{graph.node_count:,} body IDs; {graph.edge_count:,} edge records", flush=True)
    print("WARNING: connectivity-only exploratory propagation; NOT a complete neural simulator.", flush=True)
    try:
        server.serve_forever(poll_interval=0.3)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
