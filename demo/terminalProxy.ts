import type { Duplex } from "node:stream";
import type { Server as HttpServer } from "node:http";
import { Freestyle, type PtySession } from "freestyle";
import { WebSocket, WebSocketServer } from "ws";
import { demoVmSlug } from "./convex/session.js";

const TERMINAL_SLUG = "convex-demo";
const KEEPALIVE_INTERVAL_MS = 20_000;
const MAX_PENDING_INPUT_BYTES = 64 * 1024;

function rejectUpgrade(socket: Duplex, status: number, message: string) {
  socket.write(
    `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  socket.destroy();
}

function messageFor(error: unknown) {
  return error instanceof Error ? error.message : "Terminal connection failed.";
}

function isSameOrigin(origin: string | undefined, host: string | undefined) {
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function attachTerminalProxy(
  server: HttpServer,
  apiKey?: string,
  expectedPath: string | null = "/terminal",
) {
  const sockets = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (expectedPath !== null && url.pathname !== expectedPath) return;

    let vmSlug: string;
    try {
      vmSlug = demoVmSlug(url.searchParams.get("session") ?? "");
    } catch {
      rejectUpgrade(socket, 400, "Invalid browser session");
      return;
    }

    if (!apiKey) {
      rejectUpgrade(socket, 503, "Terminal not configured");
      return;
    }

    const origin = request.headers.origin;
    const host = request.headers.host;
    if (!isSameOrigin(origin, host)) {
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }

    sockets.handleUpgrade(request, socket, head, (browser) => {
      const freestyle = new Freestyle({ apiKey });
      const vm = freestyle.vms.ref(vmSlug);
      const pendingInput: Uint8Array[] = [];
      let pendingInputBytes = 0;
      let pendingResize: { cols: number; rows: number } | null = null;
      let session: PtySession | null = null;
      let closed = false;

      const keepalive = setInterval(() => {
        if (browser.readyState === WebSocket.OPEN) {
          browser.send(JSON.stringify({ type: "keepalive" }));
        }
      }, KEEPALIVE_INTERVAL_MS);

      browser.on("message", (raw, isBinary) => {
        if (isBinary) {
          const bytes = new Uint8Array(raw as Buffer);
          if (session) {
            session.write(bytes);
          } else if (
            pendingInputBytes + bytes.byteLength <=
            MAX_PENDING_INPUT_BYTES
          ) {
            pendingInput.push(bytes);
            pendingInputBytes += bytes.byteLength;
          } else {
            browser.close(1009, "Terminal input buffer exceeded");
          }
          return;
        }

        try {
          const control = JSON.parse(raw.toString()) as {
            type?: string;
            cols?: number;
            rows?: number;
          };
          if (
            control.type === "resize" &&
            Number.isInteger(control.cols) &&
            Number.isInteger(control.rows) &&
            control.cols! > 0 &&
            control.cols! <= 1_000 &&
            control.rows! > 0 &&
            control.rows! <= 500
          ) {
            pendingResize = { cols: control.cols!, rows: control.rows! };
            session?.resize(pendingResize);
          }
        } catch {
          // Ignore malformed control frames. Terminal input is always binary.
        }
      });

      const teardown = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        session?.detach();
      };

      browser.on("close", teardown);
      browser.on("error", teardown);

      void vm.pty
        .open({
          slug: TERMINAL_SLUG,
          replaceOnExit: true,
          cols: 100,
          rows: 28,
          onData: (bytes) => {
            if (browser.readyState === WebSocket.OPEN) {
              browser.send(bytes, { binary: true });
            }
          },
          onExit: () => {
            if (browser.readyState === WebSocket.OPEN) browser.close();
          },
          onError: (error) => {
            if (browser.readyState === WebSocket.OPEN) {
              browser.send(
                JSON.stringify({ type: "error", message: messageFor(error) }),
              );
            }
          },
        })
        .then((opened) => {
          session = opened;
          if (closed) {
            opened.detach();
            return;
          }
          if (pendingResize) opened.resize(pendingResize);
          for (const input of pendingInput) opened.write(input);
          pendingInput.length = 0;
          pendingInputBytes = 0;
          if (browser.readyState === WebSocket.OPEN) {
            browser.send(JSON.stringify({ type: "connected" }));
          }
        })
        .catch((error) => {
          clearInterval(keepalive);
          if (browser.readyState === WebSocket.OPEN) {
            browser.send(
              JSON.stringify({ type: "error", message: messageFor(error) }),
            );
            browser.close(1011, "Terminal connection failed");
          }
        });
    });
  });

  server.on("close", () => sockets.close());
}
