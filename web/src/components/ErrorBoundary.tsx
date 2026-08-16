"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-ink px-6">
          <div className="w-full max-w-md border border-down/40 bg-panel p-6 font-mono">
            <h1 className="text-[10px] tracking-[0.3em] text-down">[!] FATAL</h1>
            <p className="mt-3 text-[13px] leading-relaxed tracking-wider text-paper">
              THE TERMINAL CRASHED:
              <br />
              <span className="text-muted">
                {String(this.state.error.message ?? this.state.error).slice(
                  0,
                  160,
                )}
              </span>
            </p>
            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={() => {
                  this.setState({ error: null });
                  window.location.reload();
                }}
                className="border border-up/40 bg-up/10 px-4 py-2 text-[11px] font-bold tracking-[0.2em] text-up transition-colors duration-100 hover:bg-up hover:text-ink"
              >
                RESTART
              </button>
              <span className="text-[9px] tracking-[0.2em] text-faint">
                ALL LOCAL STATE IS KEPT
              </span>
            </div>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
