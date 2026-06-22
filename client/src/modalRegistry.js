const closeHandlers = [];
const listeners = new Set();

function emit() {
  const count = closeHandlers.length;
  for (const listener of listeners) {
    listener(count);
  }
}

/** Регистрирует обработчик закрытия модалки. Возвращает функцию отмены регистрации. */
export function registerModalClose(handler) {
  closeHandlers.push(handler);
  emit();
  return () => {
    const idx = closeHandlers.lastIndexOf(handler);
    if (idx >= 0) closeHandlers.splice(idx, 1);
    emit();
  };
}

export function isTopModalCloseHandler(handler) {
  return closeHandlers.length > 0 && closeHandlers[closeHandlers.length - 1] === handler;
}

export function getOpenModalCount() {
  return closeHandlers.length;
}

export function subscribeOpenModalCount(listener) {
  listeners.add(listener);
  listener(closeHandlers.length);
  return () => listeners.delete(listener);
}
