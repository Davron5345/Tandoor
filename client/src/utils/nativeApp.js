import { Capacitor } from '@capacitor/core';

const TOKEN_KEY = 'warehouse_native_token';
const BG_LOCATION_KEY = 'warehouse_bg_location_enabled';
const BRANCH_KEY = 'warehouse-branch-id';

const DEFAULT_API = 'https://tandoor-production.up.railway.app';

export function isNativeApp() {
  return Capacitor.isNativePlatform();
}

export function getApiBaseUrl() {
  const fromEnv = import.meta.env.VITE_API_URL;
  if (fromEnv) return String(fromEnv).replace(/\/$/, '');
  if (typeof window !== 'undefined' && /^https?:\/\//.test(window.location.origin)) {
    return window.location.origin;
  }
  return DEFAULT_API;
}

export function getNativeSessionToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setNativeSessionToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function isBackgroundLocationEnabled() {
  try {
    return localStorage.getItem(BG_LOCATION_KEY) === '1';
  } catch {
    return false;
  }
}

export function setBackgroundLocationEnabled(enabled) {
  try {
    if (enabled) localStorage.setItem(BG_LOCATION_KEY, '1');
    else localStorage.removeItem(BG_LOCATION_KEY);
  } catch {
    // ignore
  }
}

export function getStoredBranchId() {
  try {
    return localStorage.getItem(BRANCH_KEY) || '';
  } catch {
    return '';
  }
}
