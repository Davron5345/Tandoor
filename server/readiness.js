let ready = false;

export function isServerReady() {
  return ready || process.env.NODE_ENV === 'test';
}

export function setServerReady() {
  ready = true;
}
