import { Component, type ErrorInfo, type ReactNode } from 'react';
import { translate } from './i18n';
import { getLanguage } from './i18n/useLanguage';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled error in POS:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      // Read directly rather than through the hook: this is a class component,
      // and more to the point it is the one screen that has to render when
      // something else has already broken — depending on React machinery here
      // would risk the crash screen crashing.
      const t = (key: Parameters<typeof translate>[1]) => translate(getLanguage(), key);
      return (
        <div className="error-boundary">
          <div className="error-boundary-card">
            <div className="error-boundary-icon">⚠</div>
            <h1>{t('crash.title')}</h1>
            <p>{t('crash.body')}</p>
            <button className="btn btn-primary btn-block" onClick={() => window.location.reload()}>
              {t('crash.reload')}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
