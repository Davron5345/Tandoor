import { Component } from 'react';

function explainError(error) {
  const msg = error?.message || '';
  if (/Minified React error #310|Rendered more hooks/i.test(msg)) {
    return 'Сбой интерфейса (порядок хуков). Обновите страницу. Если не поможет — удалите приложение с домашнего экрана и установите снова.';
  }
  if (/Minified React error #300|Rendered fewer hooks/i.test(msg)) {
    return 'Сбой интерфейса. Обновите страницу.';
  }
  return msg || 'Неизвестная ошибка';
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="card app-error-boundary" style={{ margin: 24, padding: 24 }}>
          <h1 style={{ marginBottom: 12 }}>Ошибка загрузки страницы</h1>
          <p className="security-locations-hint" style={{ marginBottom: 16 }}>
            {explainError(this.state.error)}
          </p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Обновить страницу
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
