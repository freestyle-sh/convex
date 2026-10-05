import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

type TerminalStatus =
  "offline" | "connecting" | "connected" | "closed" | "error";

const encoder = new TextEncoder();

type VmTerminalProps = {
  enabled: boolean;
  expired: boolean;
  sessionId: string;
  timerLabel: string;
  controlLabel: "Pause" | "Resume" | "Retry" | "Reload";
  controlDisabled: boolean;
  controlError: string | null;
  onControl: () => void;
};

function terminalUrl(sessionId: string) {
  const configured = import.meta.env.VITE_TERMINAL_WS_URL as string | undefined;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const terminalPath = import.meta.env.DEV ? "/terminal" : "/api/terminal";
  const url = new URL(
    configured ?? `${protocol}//${window.location.host}${terminalPath}`,
    window.location.href,
  );
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  url.searchParams.set("session", sessionId);
  return url.toString();
}

export function VmTerminal({
  enabled,
  expired,
  sessionId,
  timerLabel,
  controlLabel,
  controlDisabled,
  controlError,
  onControl,
}: VmTerminalProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<TerminalStatus>("offline");
  const [connectionKey, setConnectionKey] = useState(0);

  const fitAndResize = useCallback(() => {
    const terminal = terminalRef.current;
    const fit = fitRef.current;
    if (!terminal || !fit) return;
    try {
      fit.fit();
    } catch {
      return;
    }
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "resize",
          cols: terminal.cols,
          rows: terminal.rows,
        }),
      );
    }
  }, []);

  useEffect(() => {
    if (!hostRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 12,
      lineHeight: 1.35,
      scrollback: 1_000,
      theme: {
        background: "#171415",
        foreground: "#eae4df",
        cursor: "#f7b93e",
        cursorAccent: "#171415",
        selectionBackground: "#5b4440",
        black: "#171415",
        brightBlack: "#776c69",
        red: "#ff6e65",
        yellow: "#f7b93e",
        magenta: "#c1aaf5",
        white: "#eae4df",
        brightWhite: "#fffaf3",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(hostRef.current);
    terminalRef.current = terminal;
    fitRef.current = fit;
    fit.fit();

    const input = terminal.onData((data) => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(encoder.encode(data));
      }
    });
    const resizeObserver = new ResizeObserver(fitAndResize);
    resizeObserver.observe(hostRef.current);

    return () => {
      input.dispose();
      resizeObserver.disconnect();
      socketRef.current?.close();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [fitAndResize]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    if (!enabled) {
      socketRef.current?.close();
      socketRef.current = null;
      setStatus("offline");
      terminal.reset();
      terminal.writeln(
        expired
          ? "\x1b[90mThis demo VM expired. Reload for a new box.\x1b[0m"
          : "\x1b[90mStart the VM to open its shell.\x1b[0m",
      );
      return;
    }

    let disposed = false;
    terminal.reset();
    terminal.writeln("\x1b[90mConnecting to the VM…\x1b[0m");
    setStatus("connecting");
    const socket = new WebSocket(terminalUrl(sessionId));
    socket.binaryType = "arraybuffer";
    socketRef.current = socket;

    socket.onopen = () => fitAndResize();
    socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        terminal.write(new Uint8Array(event.data));
        return;
      }
      if (typeof event.data !== "string") return;
      try {
        const message = JSON.parse(event.data) as {
          type?: string;
          message?: string;
        };
        if (message.type === "connected") {
          terminal.reset();
          setStatus("connected");
        } else if (message.type === "error") {
          terminal.writeln(
            `\r\n\x1b[31m${message.message ?? "Connection failed."}\x1b[0m`,
          );
          setStatus("error");
        }
      } catch {
        // Unknown proxy control messages do not belong in the terminal stream.
      }
    };
    socket.onerror = () => {
      if (!disposed) setStatus("error");
    };
    socket.onclose = () => {
      if (!disposed) {
        setStatus((current) => (current === "error" ? current : "closed"));
      }
    };

    return () => {
      disposed = true;
      socket.close();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [connectionKey, enabled, expired, fitAndResize, sessionId]);

  return (
    <section className="terminal-card" aria-label="Interactive VM terminal">
      <div className="terminal-bar">
        <span
          className={`terminal-timer${expired ? " is-expired" : ""}`}
          aria-label={expired ? "VM expired" : `VM expires in ${timerLabel}`}
        >
          {timerLabel}
        </span>
        <button
          className={`terminal-vm-control${controlError ? " has-error" : ""}`}
          type="button"
          onClick={onControl}
          disabled={controlDisabled}
          aria-label={
            controlLabel === "Reload"
              ? "Reload for a new VM"
              : `${controlLabel} VM`
          }
          title={
            controlError ??
            (controlLabel === "Reload"
              ? "Reload for a new VM"
              : `${controlLabel} VM`)
          }
        >
          <span>{controlLabel}</span>
        </button>
      </div>
      {controlError && (
        <span className="visually-hidden" role="alert">
          {controlError}
        </span>
      )}
      <div className="terminal-shell" ref={hostRef} />
      {(status === "closed" || status === "error") && enabled && (
        <button
          className="terminal-reconnect"
          type="button"
          onClick={() => setConnectionKey((key) => key + 1)}
        >
          Reconnect terminal
        </button>
      )}
    </section>
  );
}
