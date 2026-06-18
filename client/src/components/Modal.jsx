import { useState } from 'react';

export default function Modal({ title, children, onClose, footer, wide, className = '' }) {
  const sizeClass = wide ? ' modal-wide' : '';
  const extraClass = className ? ` ${className}` : '';
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal${sizeClass}${extraClass}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <div className="modal-header-actions">
            {footer && <div className="modal-footer-actions">{footer}</div>}
          </div>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function useToast() {
  const [toast, setToast] = useState(null);

  const show = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const Toast = toast ? (
    <div className={`alert alert-${toast.type === 'error' ? 'error' : 'success'}`}
         style={{ position: 'fixed', top: 20, right: 20, zIndex: 2000, minWidth: 280 }}>
      {toast.message}
    </div>
  ) : null;

  return { show, Toast };
}
