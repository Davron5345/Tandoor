let openCount = 0;
const listeners = new Set();

function emit() {
  for (const listener of listeners) {
    listener(openCount);
  }
}

export function registerModalOpen() {
  openCount += 1;
  emit();
  return () => {
    openCount = Math.max(0, openCount - 1);
    emit();
  };
}

export function getOpenModalCount() {
  return openCount;
}

export function subscribeOpenModalCount(listener) {
  listeners.add(listener);
  listener(openCount);
  return () => listeners.delete(listener);
}
