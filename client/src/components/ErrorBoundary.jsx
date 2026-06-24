import { Component } from 'react';

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
        <div className="card" style={{ margin: 24, padding: 24 }}>
          <h1 style={{ marginBottom: 12 }}>Ошибка загрузки страницы</h1>
          <p className="security-locations-hint" style={{ marginBottom: 16 }}>
            {this.state.error.message || 'Неизвестная ошибка'}
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
