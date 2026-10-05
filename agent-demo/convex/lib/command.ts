import { z } from "zod";

export const commandInput = z.object({
  command: z.string().trim().min(1).max(12000),
  timeoutMs: z.number().int().min(1000).max(90000),
  access: z.enum(["none", "logs", "query"]),
  functionPath: z.string().optional(),
  argsJson: z.string().max(16000).optional(),
});
export type CommandInput = z.infer<typeof commandInput>;
export type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  timeoutMs: number;
  outputTruncated: boolean;
};

// This program runs in a separate, trusted VM, never in the agent's shell VM.
// It exposes one fixed single-use operation; client URLs, headers and bodies cannot
// select a different upstream request. TLS matching alone does not deny paths.
export function projectProxyScript(request?: {
  url: string;
  method: string;
  body?: unknown;
}) {
  const config = JSON.stringify(request ?? null);
  return `import http.server, json, ssl, urllib.request, urllib.error, threading, time, pathlib
config = json.loads(${JSON.stringify(config)})
gate = threading.Lock()
claimed = False
expires = time.monotonic() + 150
receipt = pathlib.Path("/tmp/monitor-request-receipt.json")
closed = pathlib.Path("/tmp/monitor-request-closed")
pending = pathlib.Path("/tmp/monitor-request-config.json")
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): return None
client = urllib.request.build_opener(NoRedirect, urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile="/etc/ssl/certs/ca-certificates.crt")))
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)
        self.close_connection = True
    def handle_request(self):
        global claimed, config, expires
        with gate:
            if claimed or closed.exists() or (config is not None and time.monotonic() >= expires):
                self.send(409, b'{"error":"This request is consumed or expired. Do not retry writes."}')
                return
            if config is None:
                try: config = json.loads(pending.read_text())
                except Exception:
                    self.send(403, b'{"error":"This operation is not granted."}')
                    return
                expires = time.monotonic() + 150
            if self.command != config["method"] or self.path != "/request":
                self.send(403, b'{"error":"This operation is not granted."}')
                return
            claimed = True
            receipt.write_text(json.dumps({"state":"started"}))
        body = json.dumps(config["body"]).encode() if "body" in config else None
        req = urllib.request.Request(config["url"], data=body, method=config["method"], headers={"Content-Type":"application/json"})
        try:
            with client.open(req, timeout=75) as response:
                data = response.read(262145)
                if len(data) > 262144:
                    self.send(502, b'{"error":"Response exceeded 256 KiB."}')
                    return
                receipt.write_text(json.dumps({"state":"complete", "status":response.status, "body":data.decode("utf-8")}))
                self.send(response.status, data)
        except urllib.error.HTTPError as error:
            self.send(error.code, json.dumps({"error":"Convex rejected the granted request.","status":error.code}).encode())
        except Exception:
            self.send(502, b'{"error":"The granted Convex request failed or timed out."}')
    do_GET = handle_request
    do_POST = handle_request
    do_PUT = handle_request
    do_PATCH = handle_request
    do_DELETE = handle_request
    do_HEAD = handle_request
    do_OPTIONS = handle_request
http.server.ThreadingHTTPServer(("0.0.0.0", 8765), Handler).serve_forever()
`;
}

export const startProjectProxy =
  'python3 /tmp/monitor-proxy.py </dev/null >/tmp/monitor-proxy.log 2>&1 &\npython3 -c \'import socket,time\nfor attempt in range(50):\n try:\n  socket.create_connection(("127.0.0.1",8765),timeout=0.1).close(); break\n except OSError: time.sleep(0.1)\nelse: raise RuntimeError("Proxy did not start")\'';
