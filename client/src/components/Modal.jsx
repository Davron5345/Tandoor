import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const ModalCloseContext = createContext({
  intentionalClose: () => {},
});

export function useModalClose() {
  return useContext(ModalCloseContext).intentionalClose;
}

export function ModalCancelButton({
  children = 'Отмена',
  className = 'btn btn-ghost',
  ...props
}) {
  const { intentionalClose } = useContext(ModalCloseContext);
  return (
    <button type="button" className={className} onClick={intentionalClose} {...props}>
      {children}
    </button>
  );
}

export default function Modal({
  title,
  children,
  onClose,
  footer,
  wide,
  className = '',
  dirty = false,
  draftSaved = false,
}) {
  const [closePrompt, setClosePrompt] = useState(null);
  const sizeClass = wide ? ' modal-wide' : '';
  const extraClass = className ? ` ${className}` : '';

  const intentionalClose = useCallback(() => {
    if (dirty) {
      setClosePrompt('intentional');
      return;
    }
    onClose({ discardDraft: true });
  }, [dirty, onClose]);

  const accidentalClose = useCallback(() => {
    if (dirty) {
      setClosePrompt('accidental');
      return;
    }
    onClose({ discardDraft: true });
  }, [dirty, onClose]);

  const confirmClose = useCallback(() => {
    const mode = closePrompt;
    setClosePrompt(null);
    onClose({ discardDraft: mode === 'intentional' });
  }, [closePrompt, onClose]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        accidentalClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [accidentalClose]);

  return (
    <ModalCloseContext.Provider value={{ intentionalClose }}>
      <div className="modal-overlay" onClick={accidentalClose}>
        <div className={`modal${sizeClass}${extraClass}`} onClick={(e) => e.stopPropagation()}>
          {closePrompt && (
            <div className="modal-close-guard" role="dialog" aria-modal="true">
              <div className="modal-close-guard-card">
                <p className="modal-close-guard-title">Закрыть без сохранения?</p>
                <p className="modal-close-guard-text">
                  {closePrompt === 'accidental' && draftSaved
                    ? 'Несохранённые данные сохранятся как черновик — при следующем открытии можно восстановить.'
                    : 'Все несохранённые изменения будут потеряны.'}
                </p>
                <div className="modal-close-guard-actions">
                  <button type="button" className="btn btn-primary" onClick={() => setClosePrompt(null)}>
                    Продолжить редактирование
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={confirmClose}>
                    Закрыть
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className="modal-header">
            <h2>{title}</h2>
            {footer && (
              <div className="modal-header-actions">
                <div className="modal-footer-actions">{footer}</div>
              </div>
            )}
          </div>
          <div className="modal-body">{children}</div>
        </div>
      </div>
    </ModalCloseContext.Provider>
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
