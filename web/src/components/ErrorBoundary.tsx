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
        <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas px-6">
          <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-sm">
            <h1 className="text-sm font-semibold tracking-tight text-paper">Something went wrong</h1>
            <p className="mt-3 break-words font-mono text-[13px] leading-relaxed text-muted">
              {String(this.state.error.message ?? this.state.error).slice(
                0,
                160,
              )}
            </p>
            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={() => {
                  this.setState({ error: null });
                  window.location.reload();
                }}
                className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted transition-colors hover:bg-panel-2"
              >
                Reload
              </button>
              <span className="text-xs text-faint">Local state is kept</span>
            </div>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
