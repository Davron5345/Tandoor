/** Шаблоны набора поставщиков для отчёта «Долги поставщикам» (localStorage, по филиалу). */

const STORAGE_KEY = 'supplier_debt_templates_v1';

function emptyBranch() {
  return { templates: [], lastTemplateId: null };
}

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function readBranch(branchId) {
  const key = String(branchId || 'main');
  const all = readAll();
  const entry = all[key];
  if (!entry || typeof entry !== 'object') return emptyBranch();
  const templates = Array.isArray(entry.templates)
    ? entry.templates
      .filter((t) => t && t.id && t.name && Array.isArray(t.supplierIds))
      .map((t) => ({
        id: String(t.id),
        name: String(t.name).trim(),
        supplierIds: [...new Set(t.supplierIds.map(String).filter(Boolean))],
      }))
      .filter((t) => t.name)
    : [];
  const lastTemplateId = entry.lastTemplateId != null ? String(entry.lastTemplateId) : null;
  return { templates, lastTemplateId };
}

function writeBranch(branchId, state) {
  const key = String(branchId || 'main');
  const all = readAll();
  all[key] = {
    templates: state.templates,
    lastTemplateId: state.lastTemplateId || null,
  };
  writeAll(all);
}

export function listSupplierDebtTemplates(branchId) {
  return readBranch(branchId).templates;
}

export function getLastSupplierDebtTemplateId(branchId) {
  return readBranch(branchId).lastTemplateId;
}

export function setLastSupplierDebtTemplateId(branchId, templateId) {
  const state = readBranch(branchId);
  state.lastTemplateId = templateId || null;
  writeBranch(branchId, state);
}

export function saveSupplierDebtTemplate(branchId, { id = null, name, supplierIds }) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Укажите название шаблона');
  const ids = [...new Set((supplierIds || []).map(String).filter(Boolean))];
  if (!ids.length) throw new Error('Выберите хотя бы одного поставщика');

  const state = readBranch(branchId);
  const existingIdx = id ? state.templates.findIndex((t) => t.id === String(id)) : -1;
  let template;
  if (existingIdx >= 0) {
    template = {
      ...state.templates[existingIdx],
      name: trimmed,
      supplierIds: ids,
    };
    state.templates[existingIdx] = template;
  } else {
    template = {
      id: `sdt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      name: trimmed,
      supplierIds: ids,
    };
    state.templates.push(template);
  }
  state.templates.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  state.lastTemplateId = template.id;
  writeBranch(branchId, state);
  return template;
}

export function deleteSupplierDebtTemplate(branchId, templateId) {
  const state = readBranch(branchId);
  const id = String(templateId || '');
  state.templates = state.templates.filter((t) => t.id !== id);
  if (state.lastTemplateId === id) state.lastTemplateId = null;
  writeBranch(branchId, state);
}
