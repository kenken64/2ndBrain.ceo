"use client";

import { Maximize2, PlugZap, TerminalSquare, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type ConsoleStatus = "closed" | "connecting" | "connected" | "error";

type SshConsoleMessage =
  | { data: string; type: "data" }
  | { message: string; type: "error" | "exit" | "ready" | "status" };

type XtermModule = typeof import("@xterm/xterm");
type FitModule = typeof import("@xterm/addon-fit");
type TerminalInstance = import("@xterm/xterm").Terminal;
type FitAddonInstance = import("@xterm/addon-fit").FitAddon;

function websocketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/openclaw/ssh`;
}

function parseMessage(value: MessageEvent<string>): SshConsoleMessage | null {
  try {
    return JSON.parse(value.data) as SshConsoleMessage;
  } catch {
    return null;
  }
}

export function SshConsolePanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<ConsoleStatus>("closed");
  const [statusText, setStatusText] = useState("Console closed");
  const [error, setError] = useState<string | null>(null);
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<TerminalInstance | null>(null);
  const fitAddonRef = useRef<FitAddonInstance | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    let isCancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let dataDisposable: { dispose: () => void } | null = null;
    let resizeTimer: number | null = null;

    function writeLine(message: string) {
      terminalRef.current?.writeln(`\r\n${message}`);
    }

    function fitAndSendResize() {
      const socket = socketRef.current;
      const terminal = terminalRef.current;
      const fitAddon = fitAddonRef.current;

      if (!terminal || !fitAddon) {
        return;
      }

      try {
        fitAddon.fit();
      } catch {
        return;
      }

      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            cols: terminal.cols,
            rows: terminal.rows,
            type: "resize"
          })
        );
      }
    }

    async function startConsole() {
      setStatus("connecting");
      setStatusText("Preparing terminal...");
      setError(null);

      const [{ Terminal }, { FitAddon }] = (await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit")
      ])) as [XtermModule, FitModule];

      if (isCancelled || !terminalHostRef.current) {
        return;
      }

      const terminal = new Terminal({
        allowProposedApi: false,
        convertEol: true,
        cursorBlink: true,
        cursorStyle: "block",
        disableStdin: false,
        fontFamily: "var(--font-mono)",
        fontSize: 13,
        letterSpacing: 0,
        lineHeight: 1.15,
        scrollback: 4000,
        theme: {
          background: "#07111f",
          black: "#111827",
          blue: "#38bdf8",
          brightBlack: "#64748b",
          brightBlue: "#7dd3fc",
          brightCyan: "#67e8f9",
          brightGreen: "#6ee7b7",
          brightMagenta: "#f0abfc",
          brightRed: "#fca5a5",
          brightWhite: "#ffffff",
          brightYellow: "#fde68a",
          cursor: "#00c48c",
          cyan: "#22d3ee",
          foreground: "#d7e4f2",
          green: "#34d399",
          magenta: "#d946ef",
          red: "#f87171",
          selectionBackground: "#164e63",
          white: "#e5edf6",
          yellow: "#facc15"
        }
      });
      const fitAddon = new FitAddon();

      terminal.loadAddon(fitAddon);
      terminal.open(terminalHostRef.current);
      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      terminal.writeln("Opening secure OpenClaw SSH console...");

      window.requestAnimationFrame(fitAndSendResize);

      resizeObserver = new ResizeObserver(() => {
        if (resizeTimer) {
          window.clearTimeout(resizeTimer);
        }

        resizeTimer = window.setTimeout(fitAndSendResize, 80);
      });
      resizeObserver.observe(terminalHostRef.current);

      const supabase = createClient();
      const { data, error: sessionError } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;

      if (isCancelled) {
        return;
      }

      if (sessionError || !accessToken) {
        const message = "Login session is required before SSH can start.";
        setStatus("error");
        setStatusText(message);
        setError(message);
        writeLine(message);
        return;
      }

      setStatusText("Connecting to SSH proxy...");
      const socket = new WebSocket(websocketUrl());
      socketRef.current = socket;

      dataDisposable = terminal.onData((input) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({
              data: input,
              type: "input"
            })
          );
        }
      });

      socket.addEventListener("open", () => {
        setStatusText("Authenticating...");
        socket.send(
          JSON.stringify({
            accessToken,
            cols: terminal.cols,
            rows: terminal.rows,
            type: "auth"
          })
        );
      });

      socket.addEventListener("message", (event) => {
        const message = parseMessage(event);

        if (!message) {
          return;
        }

        if (message.type === "data") {
          terminal.write(message.data);
          return;
        }

        if (message.type === "ready") {
          setStatus("connected");
          setStatusText(message.message);
          writeLine(message.message);
          fitAndSendResize();
          return;
        }

        if (message.type === "status") {
          setStatusText(message.message);
          writeLine(message.message);
          return;
        }

        if (message.type === "exit") {
          setStatus("closed");
          setStatusText(message.message);
          writeLine(message.message);
          return;
        }

        if (message.type === "error") {
          setStatus("error");
          setStatusText(message.message);
          setError(message.message);
          writeLine(`Error: ${message.message}`);
        }
      });

      socket.addEventListener("close", () => {
        if (!isCancelled) {
          setStatus((current) => (current === "error" ? current : "closed"));
          setStatusText("SSH console disconnected.");
        }
      });

      socket.addEventListener("error", () => {
        const message = "SSH WebSocket connection failed.";
        setStatus("error");
        setStatusText(message);
        setError(message);
        writeLine(`Error: ${message}`);
      });
    }

    void startConsole();

    return () => {
      isCancelled = true;
      if (resizeTimer) {
        window.clearTimeout(resizeTimer);
      }

      resizeObserver?.disconnect();
      dataDisposable?.dispose();
      socketRef.current?.close();
      socketRef.current = null;
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  return (
    <>
      <button className="btn-ghost ssh-console-trigger" onClick={() => setIsOpen(true)} type="button">
        <TerminalSquare size={16} strokeWidth={2} />
        SSH Console
      </button>
      {isOpen ? (
        <div aria-modal="true" className="ssh-console" role="dialog">
          <button
            aria-label="Close SSH console"
            className="ssh-console__scrim"
            onClick={() => setIsOpen(false)}
            type="button"
          />
          <section className="ssh-console__panel">
            <header className="ssh-console__header">
              <div>
                <span className="ssh-console__eyebrow">
                  <PlugZap size={15} strokeWidth={2} />
                  OpenClaw secure shell
                </span>
                <h2>SSH Console</h2>
                <p>{statusText}</p>
              </div>
              <div className="ssh-console__actions">
                <span className={`ssh-console__status is-${status}`}>{status}</span>
                <button
                  aria-label="Resize terminal"
                  className="btn-icon"
                  onClick={() => {
                    fitAddonRef.current?.fit();
                    terminalRef.current?.focus();
                  }}
                  type="button"
                >
                  <Maximize2 size={16} strokeWidth={2} />
                </button>
                <button
                  aria-label="Close SSH console"
                  className="btn-icon"
                  onClick={() => setIsOpen(false)}
                  type="button"
                >
                  <X size={18} strokeWidth={2} />
                </button>
              </div>
            </header>
            {error ? <p className="ssh-console__error">{error}</p> : null}
            <div className="ssh-console__terminal" ref={terminalHostRef} />
            <footer className="ssh-console__footer">
              Session is proxied through this app. Closing the panel terminates the SSH connection.
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
