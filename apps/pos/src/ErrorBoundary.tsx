import { Component, type ErrorInfo, type ReactNode } from 'react';

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
      return (
        <div className="error-boundary">
          <div className="error-boundary-card">
            <div className="error-boundary-icon">⚠</div>
            <h1>Что-то пошло не так</h1>
            <p>Произошла непредвиденная ошибка кассы. Уже пробитые продажи сохранены — но текущую корзину придётся собрать заново.</p>
            <button className="btn btn-primary btn-block" onClick={() => window.location.reload()}>
              Перезагрузить кассу
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
