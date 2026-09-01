import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isTopModalCloseHandler, registerModalClose } from '../modalRegistry';

const ModalCloseContext = createContext({
  intentionalClose: () => {},
});

let openModalCount = 0;

function lockPageScroll() {
  openModalCount += 1;
  document.documentElement.classList.add('app-modal-open');
}

function unlockPageScroll() {
  openModalCount = Math.max(0, openModalCount - 1);
  if (openModalCount === 0) {
    document.documentElement.classList.remove('app-modal-open');
  }
}

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
  footerPlacement = 'header',
  wide,
  className = '',
  dirty = false,
  closeOnBackdrop = false,
}) {
  const [closePrompt, setClosePrompt] = useState(false);
  const sizeClass = wide ? ' modal-wide' : '';
  const extraClass = className ? ` ${className}` : '';

  const requestClose = useCallback(() => {
    if (dirty) {
      setClosePrompt(true);
      return;
    }
    onClose();
  }, [dirty, onClose]);

  const confirmClose = useCallback(() => {
    setClosePrompt(false);
    onClose();
  }, [onClose]);

  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useEffect(() => {
    const closeHandler = () => requestCloseRef.current();
    const unregister = registerModalClose(closeHandler);
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (!isTopModalCloseHandler(closeHandler)) return;
      e.preventDefault();
      e.stopPropagation();
      closeHandler();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    lockPageScroll();
    return () => {
      unregister();
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      unlockPageScroll();
    };
  }, []);

  return createPortal(
    <ModalCloseContext.Provider value={{ intentionalClose: requestClose }}>
      <div
        className="modal-overlay"
        onClick={closeOnBackdrop ? requestClose : undefined}
      >
        <div className={`modal${sizeClass}${extraClass}`} onClick={(e) => e.stopPropagation()}>
          {closePrompt && (
            <div className="modal-close-guard" role="dialog" aria-modal="true">
              <div className="modal-close-guard-card">
                <p className="modal-close-guard-title">Закрыть без сохранения?</p>
                <p className="modal-close-guard-text">
                  Все несохранённые изменения будут потеряны.
                </p>
                <div className="modal-close-guard-actions">
                  <button type="button" className="btn btn-primary" onClick={() => setClosePrompt(false)}>
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
            {footer && footerPlacement !== 'end' && (
              <div className="modal-header-actions">
                <div className="modal-footer-actions">{footer}</div>
              </div>
            )}
          </div>
          <div className="modal-body">{children}</div>
          {footer && footerPlacement === 'end' && (
            <div className="modal-footer">
              <div className="modal-footer-actions">{footer}</div>
            </div>
          )}
        </div>
      </div>
    </ModalCloseContext.Provider>,
    document.body,
  );
}

export function useToast() {
  const [toast, setToast] = useState(null);

  const show = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const Toast = toast ? (
    <div className={`alert alert-${toast.type === 'error' ? 'error' : 'success'}`}
         style={{ position: 'fixed', top: 20, right: 20, zIndex: 2000, minWidth: 280 }}>
      {toast.message}
    </div>
  ) : null;

  return { show, Toast };
}
