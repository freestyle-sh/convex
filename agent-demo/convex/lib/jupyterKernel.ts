// The bridge is local-only inside an untrusted, credential-free Freestyle VM.
// Jupyter owns execution, persistent variables and MIME output; this bridge
// carries bounded cells/results over Freestyle exec without a public endpoint.
export const kernelPreloadVersion = 5;
export const kernelPreloads = String.raw`import urllib.request, urllib.error, urllib.parse, json

def request_json(index=0):
    """Consume one authorized route once; return its JSON value. Never retries."""
    route = network[index]
    request = urllib.request.Request(route["url"], method=route["method"])
    with urllib.request.urlopen(request, timeout=75) as response:
        payload = json.load(response)
    if isinstance(payload, dict):
        if payload.get("status") == "error":
            raise RuntimeError(str(payload.get("errorMessage", "Convex request failed"))[:1000])
        if payload.get("status") == "success" and "value" in payload:
            return payload["value"]
    return payload

def current_artifact():
    """Return the exact chart/table version being edited, without credentials."""
    value = _monitor_context.get("artifact")
    if value is None:
        raise ValueError("No artifact is attached to this notebook cell")
    return json.loads(json.dumps(value))

def replace_results():
    """Replace this response's earlier displayed results with this cell's complete final set."""
    print("__WORKBENCH_REPLACE_RESULTS__")

def display_table(value, title="Results"):
    """Display a bounded, sortable table. The original Python data stays intact."""
    import pandas as pd
    frame = value if isinstance(value, pd.DataFrame) else pd.DataFrame(value)
    if not len(frame.columns):
        print("No table columns to display.")
        return
    shown = frame.iloc[:200, :20]
    split = json.loads(shown.to_json(orient="split", date_format="iso", default_handler=str))
    table = {"title": str(title)[:160], "columns": [str(c)[:80] for c in split["columns"]],
             "rows": [[str(v)[:500] if isinstance(v, (str, dict, list)) else v for v in row] for row in split["data"]],
             "totalRows": len(frame), "truncated": len(shown) != len(frame) or len(shown.columns) != len(frame.columns)}
    table["truncated"] = table["truncated"] or any(len(str(c)) > 80 for c in split["columns"]) or any(isinstance(v, (str, dict, list)) and len(str(v)) > 500 for row in split["data"] for v in row)
    while len(json.dumps(table, ensure_ascii=True)) > 5500 and table["rows"]:
        table["rows"].pop()
        table["truncated"] = True
    print("__WORKBENCH_TABLE__" + json.dumps(table, ensure_ascii=True))
`;

export const kernelScript = String.raw`import http.server, json, time, re, queue, sys
from jupyter_client import KernelManager

km = KernelManager(kernel_name="python3")
km.start_kernel(stdout=open("/tmp/monitor-kernel.log", "a"), stderr=open("/tmp/monitor-kernel.log", "a"))
kc = km.blocking_client()
kc.start_channels()
kc.wait_for_ready(timeout=30)
initialization = ${JSON.stringify(kernelPreloads)} + "\nimport json, pandas as pd, numpy as np, plotly.graph_objects as go, plotly.express as px, plotly.io as pio\nfrom IPython.display import display\npio.renderers.default = 'plotly_mimetype'"

def run_silent(code):
    msg_id = kc.execute(code, silent=True, store_history=False, allow_stdin=False)
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        msg = kc.get_shell_msg(timeout=10)
        if msg.get("parent_header", {}).get("msg_id") == msg_id:
            if msg["content"].get("status") != "ok": raise RuntimeError("Kernel initialization failed")
            return
    raise RuntimeError("Kernel initialization timed out")

run_silent(initialization)

def plain_arrays(value):
    # Plotly 6 uses typed-array MIME payloads. Convert to ordinary JSON arrays
    # so the controller can validate sizes/types before storing or rendering.
    if isinstance(value, dict):
        if "bdata" in value and "dtype" in value:
            import base64, numpy as np
            dtype = value["dtype"]
            if dtype not in ("i1", "u1", "i2", "u2", "i4", "u4", "f4", "f8"): raise ValueError("Unsupported dtype")
            a = np.frombuffer(base64.b64decode(value["bdata"]), dtype=dtype)
            if a.size > 40000: raise ValueError("Chart exceeds point limit")
            if "shape" in value: a = a.reshape(tuple(int(s.strip()) for s in value["shape"].split(",")))
            return plain_arrays(a.tolist())
        return {k: plain_arrays(v) for k, v in value.items()}
    if isinstance(value, list): return [plain_arrays(v) for v in value]
    if isinstance(value, float) and not __import__("math").isfinite(value): return None
    return value

def execute(payload):
    code = payload["code"]
    timeout = max(1, min(90, payload["timeoutMs"] / 1000))
    if not isinstance(code, str) or len(code) > 12000: raise ValueError("Invalid cell")
    context = json.dumps(json.dumps(payload.get("context", {})))
    run_silent("_monitor_context = json.loads(" + context + ")\nproject = _monitor_context.get('project', {})\ndata = _monitor_context.get('events', [])\nresults = _monitor_context.get('results', [])\nnetwork = _monitor_context.get('network', [])\n")
    result = {"status":"ok", "executionCount":0, "stdout":"", "stderr":"", "text":"", "charts":[], "chartWarnings":[], "outputTruncated":False, "kernelReset":False, "durationMs":0}
    started = time.monotonic()
    deadline = started + timeout
    msg_id = kc.execute(code, store_history=True, allow_stdin=False, stop_on_error=True)
    deferred_clear = False
    def append(key, text):
        text = re.sub(r"\x1b\[[0-9;]*[a-zA-Z]", "", str(text))
        remaining = 12000 - len(result[key])
        result[key] += text[:remaining]
        if len(text) > remaining: result["outputTruncated"] = True
    while True:
        if time.monotonic() >= deadline:
            result["status"] = "timeout"
            km.interrupt_kernel()
            # The controller deletes this VM after receiving a timeout result.
            # Stop the kernel immediately; do not reuse half-mutated variables.
            km.shutdown_kernel(now=True)
            kc.stop_channels()
            result["kernelReset"] = True
            break
        try: msg = kc.get_iopub_msg(timeout=min(0.2, max(0.001, deadline-time.monotonic())))
        except queue.Empty: continue
        if msg.get("parent_header", {}).get("msg_id") != msg_id: continue
        kind, content = msg["msg_type"], msg["content"]
        if kind == "status" and content.get("execution_state") == "idle": break
        if kind == "execute_input": result["executionCount"] = content.get("execution_count", 0)
        if kind == "clear_output":
            deferred_clear = bool(content.get("wait"))
            if not deferred_clear:
                for key in ("stdout", "stderr", "text"): result[key] = ""
                result["charts"] = []
        if kind in ("stream", "error", "execute_result", "display_data", "update_display_data"):
            if deferred_clear:
                for key in ("stdout", "stderr", "text"): result[key] = ""
                result["charts"] = []
                deferred_clear = False
            if kind == "stream": append("stderr" if content.get("name") == "stderr" else "stdout", content.get("text", ""))
            elif kind == "error":
                result["status"] = "error"
                append("stderr", "\n".join(content.get("traceback", [])))
            else:
                mime = content.get("data", {})
                chart = mime.get("application/vnd.plotly.v1+json")
                if chart is not None:
                    try:
                        chart = plain_arrays(chart)
                        # Templates add large unused default structures.
                        if isinstance(chart.get("layout"), dict): chart["layout"].pop("template", None)
                        if len(result["charts"]) >= 4 or len(json.dumps(chart)) > 60000: raise ValueError("Chart too large")
                        result["charts"].append(chart)
                    except Exception:
                        if len(result["chartWarnings"]) < 5: result["chartWarnings"].append("Chart exceeds display limits; aggregate or sample the data.")
                elif "text/plain" in mime: append("text", mime["text/plain"] + "\n")
                # HTML and JavaScript MIME bundles are intentionally ignored.
    result["durationMs"] = int((time.monotonic() - started)*1000)
    return result

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        self.send_response(200 if self.path == "/health" else 404)
        self.end_headers()
    def do_POST(self):
        if self.path != "/execute": self.send_error(404); return
        length = int(self.headers.get("Content-Length", 0))
        if not 0 < length <= 300000: self.send_error(413); return
        try:
            result = execute(json.loads(self.rfile.read(length)))
            body = json.dumps(result, allow_nan=False).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception:
            self.send_error(500, "Notebook kernel unavailable; start a new session")

http.server.HTTPServer(("127.0.0.1", 8766), Handler).serve_forever()
`;

export const installKernel =
  "python3 -m venv /tmp/monitor-jupyter-venv && /tmp/monitor-jupyter-venv/bin/pip install --disable-pip-version-check --no-input --cert /etc/ssl/certs/ca-certificates.crt 'ipykernel==7.4.0' 'jupyter-client==8.10.0' 'nbformat==5.11.1' 'plotly==7.1.0' 'pandas==3.0.6' && /tmp/monitor-jupyter-venv/bin/python -m ipykernel install --prefix /tmp/monitor-jupyter-venv --name python3";
export const startKernel =
  "nohup /tmp/monitor-jupyter-venv/bin/python /tmp/monitor-jupyter.py </dev/null >/tmp/monitor-jupyter.log 2>&1 &\nfor i in $(seq 1 60); do curl -fsS http://127.0.0.1:8766/health >/dev/null && exit 0; sleep 0.5; done; exit 1";
