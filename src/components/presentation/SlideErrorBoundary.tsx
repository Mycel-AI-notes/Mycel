import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** Raw slide markdown, shown verbatim if rendering blows up. */
  fallbackText: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Keeps a single malformed slide from white-screening the whole show. If the
 * slide renderer throws (exotic LaTeX, pathological markdown, …) we fall back
 * to the raw markdown in a scrollable block instead of crashing the app.
 *
 * Reset per slide by giving the boundary `key={current}` at the call site, so
 * navigating away from a bad slide clears the error.
 */
export class SlideErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Slide render failed:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="prose-mycel">
          <p className="text-text-muted text-sm">
            This slide couldn’t be rendered. Showing its source:
          </p>
          <pre style={{ whiteSpace: 'pre-wrap' }}>
            <code>{this.props.fallbackText}</code>
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
