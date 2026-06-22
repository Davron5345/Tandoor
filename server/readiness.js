let ready = false;
let initError = null;

export function isServerReady() {
  return ready || process.env.NODE_ENV === 'test';
}

export function getServerInitError() {
  return initError;
}

export function setServerReady() {
  ready = true;
  initError = null;
}

export function setServerInitError(err) {
  ready = false;
  initError = err?.message || String(err);
}
