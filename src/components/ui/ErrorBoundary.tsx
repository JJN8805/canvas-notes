import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** What to show instead of the broken part. `reset` tries again (it renders the children afresh). */
  fallback: (error: Error, reset: () => void) => ReactNode;
  /** When this changes (say, the page route) a shown error is cleared and the children are tried again. */
  resetKey?: unknown;
  children: ReactNode;
}

/**
 * Without one of these, an error while drawing any part of the screen makes React throw the WHOLE app away: a blank window that
 * looks frozen. With it, only the broken part is replaced by a message and the rest keeps working (notes are saved as you go).
 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('A part of the app failed and was replaced by a message:', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    return this.state.error ? this.props.fallback(this.state.error, () => this.setState({ error: null })) : this.props.children;
  }
}
