import { useEffect } from 'react';

const STORAGE_PREFIX = 'form-draft:';

export function formDraftKey(page, modalId) {
  if (!page || modalId == null || modalId === '') return null;
  const id = modalId === 'create' || modalId === 'transfer' ? modalId : String(modalId);
  return `${page}:${id}`;
}

export function readFormDraft(key) {
  if (!key) return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeFormDraft(key, payload) {
  if (!key) return;
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify({
      ...payload,
      savedAt: Date.now(),
    }));
  } catch {
    // sessionStorage quota or private mode
  }
}

export function clearFormDraft(key) {
  if (!key) return;
  sessionStorage.removeItem(STORAGE_PREFIX + key);
}

export function formatDraftAge(savedAt) {
  if (!savedAt) return '';
  const mins = Math.round((Date.now() - savedAt) / 60000);
  if (mins < 1) return 'только что';
  if (mins < 60) return `${mins} мин. назад`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} ч. назад`;
  return 'ранее сегодня';
}

export function promptRestoreDraft(draft, entityLabel = 'черновик') {
  if (!draft?.savedAt) return false;
  return window.confirm(
    `Найден ${entityLabel} (${formatDraftAge(draft.savedAt)}). Восстановить?`,
  );
}

export function useFormDraft(key, payload, enabled = false) {
  useEffect(() => {
    if (!enabled || !key) return undefined;
    const timer = window.setTimeout(() => {
      writeFormDraft(key, payload);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [key, payload, enabled]);
}
