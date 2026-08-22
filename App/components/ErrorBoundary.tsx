import React, { Component, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional fallback UI; defaults to a compact error card */
  fallback?: ReactNode;
  /** Optional label for logging (e.g. "NodeInspector") */
  label?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Lightweight React Error Boundary.
 *
 * Catches rendering errors in its subtree so a single broken component
 * cannot crash the entire app (which would remount with default state
 * and appear to "navigate back to the home page").
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const label = this.props.label || 'ErrorBoundary';
    console.error(`[${label}] rendering error:`, error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="p-2 rounded-md bg-red-50 border border-red-200 text-xs text-red-700 space-y-1">
          <div className="font-semibold flex items-center gap-1">
            <span>⚠️</span> Render Error
          </div>
          <div className="text-red-600 break-all">
            {this.state.error?.message || 'Unknown error'}
          </div>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-1 px-2 py-0.5 rounded bg-red-100 hover:bg-red-200 text-red-800 text-[10px] cursor-pointer"
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}