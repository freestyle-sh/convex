import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { projectProxyScript } from "../convex/lib/command";

it.each(["GET", "POST"])(
  "the generated %s proxy rejects alternate routes and never forwards shell-supplied arguments",
  (method) => {
    const body =
      method === "POST"
        ? { path: "health:read", args: { tenant: "one" }, format: "json" }
        : undefined;
    const program =
      `import http.server, ssl, types, json
# Run the actual generated handler without a socket or network connection.
http.server.ThreadingHTTPServer = lambda *args: types.SimpleNamespace(serve_forever=lambda: None)
ssl.create_default_context = lambda **kwargs: None
` +
      projectProxyScript({
        url: `https://test.convex.cloud/api/${method === "GET" ? "stream_function_logs?cursor=5" : "query"}`,
        method,
        body,
      }) +
      `
requests = []
class Response:
    status = 200
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def read(self, size): return b'{"ok":true}'
def upstream(req, timeout):
    requests.append({"url":req.full_url,"method":req.method,"body":json.loads(req.data) if req.data else None,"headers":dict(req.headers),"timeout":timeout})
    return Response()
client = types.SimpleNamespace(open=upstream)
results = []
for method, path in [("DELETE","/request"),("POST","/api/mutation"),("GET","/request?url=https://other.example"),("GET","https://other.example/request"),(config["method"],"/request/") ,(config["method"],"/request"),(config["method"],"/request")]:
    handler = object.__new__(Handler)
    handler.command, handler.path = method, path
    handler.headers = {"Authorization":"attacker","Host":"other.example","Content-Type":"application/json"}
    handler.rfile = types.SimpleNamespace(read=lambda *args: b'{"path":"data:deleteEverything","args":{}}')
    handler.send = lambda status, body: results.append(status)
    handler.handle_request()
print(json.dumps({"statuses":results,"requests":requests}))
`;
    const result = JSON.parse(
      execFileSync("python3", ["-c", program], {
        encoding: "utf8",
        timeout: 5000,
      }),
    );
    expect(result.statuses).toEqual([403, 403, 403, 403, 403, 200, 409]);
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]).toMatchObject({
      method,
      body: body ?? null,
      timeout: 75,
    });
    expect(result.requests[0].headers).toEqual({
      "Content-type": "application/json",
    });
    expect(JSON.stringify(result.requests)).not.toContain(
      "data:deleteEverything",
    );
    expect(JSON.stringify(result.requests)).not.toContain("attacker");
  },
);

it("claims a request atomically even when concurrent Python clients race and upstream fails", () => {
  const program =
    `import http.server, ssl, types, json, concurrent.futures
http.server.ThreadingHTTPServer = lambda *args: types.SimpleNamespace(serve_forever=lambda: None)
ssl.create_default_context = lambda **kwargs: None
` +
    projectProxyScript({
      url: "https://test.convex.cloud/api/mutation",
      method: "POST",
      body: { path: "jobs:retry", args: { id: "one" } },
    }) +
    `
requests = []
def upstream(req, timeout):
    requests.append(req.full_url)
    time.sleep(0.02)
    raise TimeoutError("ambiguous write")
client = types.SimpleNamespace(open=upstream)
def call(i):
    result = []
    handler = object.__new__(Handler)
    handler.command, handler.path = "POST", "/request"
    handler.send = lambda status, body: result.append(status)
    handler.handle_request()
    return result[0]
with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
    statuses = list(pool.map(call, range(16)))
print(json.dumps({"count":len(requests),"statuses":statuses}))
`;
  const result = JSON.parse(
    execFileSync("python3", ["-c", program], {
      encoding: "utf8",
      timeout: 5000,
    }),
  );
  expect(result.count).toBe(1);
  expect(result.statuses.filter((s: number) => s === 409)).toHaveLength(15);
  expect(result.statuses.filter((s: number) => s === 502)).toHaveLength(1);
});

it.each([false, true])(
  "a dormant relay denies requests until armed and remains sealed (close unused: %s)",
  (closeUnused) => {
    const program =
      `import http.server, ssl, types, json, tempfile
http.server.ThreadingHTTPServer = lambda *args: types.SimpleNamespace(serve_forever=lambda: None)
ssl.create_default_context = lambda **kwargs: None
` +
      projectProxyScript() +
      `
with tempfile.TemporaryDirectory() as directory:
    closed = pathlib.Path(directory) / "closed"
    pending = pathlib.Path(directory) / "config"
    receipt = pathlib.Path(directory) / "receipt"
    calls = []
    statuses = []
    class Response:
        status = 200
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def read(self, size): return b'{"status":"success","value":42}'
    def upstream(req, timeout):
        calls.append({"url": req.full_url, "body": json.loads(req.data)})
        return Response()
    client = types.SimpleNamespace(open=upstream)
    def call():
        handler = object.__new__(Handler)
        handler.command, handler.path = "POST", "/request"
        handler.rfile = types.SimpleNamespace(read=lambda *args: b'{"path":"jobs:delete"}')
        handler.send = lambda status, body: statuses.append(status)
        handler.handle_request()
    call()
    pending.write_text(json.dumps({"url":"https://test.convex.cloud/api/query", "method":"POST", "body":{"path":"health:read","args":{"tenant":"one"}}}))
    if ${closeUnused ? "True" : "False"}: closed.write_text("closed")
    call()
    closed.write_text("closed")
    pending.write_text(json.dumps({"url":"https://test.convex.cloud/api/mutation", "method":"POST", "body":{"path":"jobs:delete"}}))
    call()
    print(json.dumps({"statuses":statuses, "calls":calls}))
`;
    const result = JSON.parse(
      execFileSync("python3", ["-c", program], {
        encoding: "utf8",
        timeout: 5000,
      }),
    );
    expect(result.statuses).toEqual(
      closeUnused ? [403, 409, 409] : [403, 200, 409],
    );
    expect(result.calls).toEqual(
      closeUnused
        ? []
        : [
            {
              url: "https://test.convex.cloud/api/query",
              body: { path: "health:read", args: { tenant: "one" } },
            },
          ],
    );
  },
);
