/**
 * Catches an error while drawing its children, so one broken part shows a
 * message instead of blanking the whole window (React's default: an error in
 * rendering unmounts everything). Error boundaries have to be class
 * components; React has no hook for this.
 */
import { Component, type ReactNode } from 'react';
import { errorText, logError } from '../../state/error-log';

interface Props {
  /** What broke, for the message ("this page"). */
  what: string;
  children: ReactNode;
}

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown) {
    console.error(`${this.props.what} failed to draw:`, error);
    logError(`${this.props.what} failed to draw: ${errorText(error)}`);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="error-boundary" role="alert">
        <p>Something went wrong drawing {this.props.what}.</p>
        <pre>{error.message}{'\n'}{error.stack?.split('\n').slice(1, 6).join('\n')}</pre>
        <button type="button" className="btn" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
