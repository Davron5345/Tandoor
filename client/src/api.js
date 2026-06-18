const API = '/api';
let authToken = null;
let activeBranchId = null;

export function setAuthToken(token) {
  authToken = token;
}

export function setActiveBranchId(id) {
  activeBranchId = id || null;
}

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  let url = `${API}${path}`;
  if (activeBranchId) {
    const sep = url.includes('?') ? '&' : '?';
    url += `${sep}branch_id=${encodeURIComponent(activeBranchId)}`;
  }

  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

export const api = {
  login: async (username, password) => {
    let res;
    try {
      res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
    } catch {
      throw new Error('Сервер недоступен. Запустите: npm run dev');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Неверный логин или пароль');
    return data;
  },
  logout: () => request('/auth/logout', { method: 'POST' }),
  getMe: () => request('/auth/me'),
  getRoles: () => request('/auth/roles'),
  getRolesList: () => request('/roles/list'),
  createRole: (data) => request('/roles', { method: 'POST', body: JSON.stringify(data) }),
  updateRole: (id, data) => request(`/roles/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRole: (id) => request(`/roles/${id}`, { method: 'DELETE' }),
  getPermissionsConfig: () => request('/roles/permissions/config'),
  getRolePermissions: (role) => request(`/roles/${role}/permissions`),
  saveRolePermissions: (role, matrix) => request(`/roles/${role}/permissions`, {
    method: 'PUT',
    body: JSON.stringify({ matrix }),
  }),

  getUsers: () => request('/users'),
  createUser: (data) => request('/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id, data) => request(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteUser: (id) => request(`/users/${id}`, { method: 'DELETE' }),

  getBranches: () => request('/branches'),
  createBranch: (data) => request('/branches', { method: 'POST', body: JSON.stringify(data) }),
  updateBranch: (id, data) => request(`/branches/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteBranch: (id) => request(`/branches/${id}`, { method: 'DELETE' }),

  getDepartments: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/departments${q ? `?${q}` : ''}`);
  },
  createDepartment: (data) => request('/departments', { method: 'POST', body: JSON.stringify(data) }),
  updateDepartment: (id, data) => request(`/departments/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDepartment: (id) => request(`/departments/${id}`, { method: 'DELETE' }),

  getStats: () => request('/stats'),
  getStockReport: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/reports/stock${q ? `?${q}` : ''}`);
  },
  getDebtorsReport: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/reports/debtors${q ? `?${q}` : ''}`);
  },
  getCreditorsReport: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/reports/creditors${q ? `?${q}` : ''}`);
  },
  getProductCategories: () => request('/product-categories'),
  createProductCategory: (data) => request('/product-categories', { method: 'POST', body: JSON.stringify(data) }),
  updateProductCategory: (id, data) => request(`/product-categories/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProductCategory: (id) => request(`/product-categories/${id}`, { method: 'DELETE' }),

  getProducts: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/products${q ? `?${q}` : ''}`);
  },
  createProduct: (data) => request('/products', { method: 'POST', body: JSON.stringify(data) }),
  updateProduct: (id, data) => request(`/products/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProduct: (id) => request(`/products/${id}`, { method: 'DELETE' }),

  getCalculations: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/calculations${q ? `?${q}` : ''}`);
  },
  getCalculation: (id) => request(`/calculations/${id}`),
  applyCalculation: (id, data) => request(`/calculations/${id}/apply`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  createCalculation: (data) => request('/calculations', { method: 'POST', body: JSON.stringify(data) }),
  updateCalculation: (id, data) => request(`/calculations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCalculation: (id) => request(`/calculations/${id}`, { method: 'DELETE' }),

  getProductImages: (productId, variantId = null) => {
    const q = variantId ? `?variant_id=${encodeURIComponent(variantId)}` : '';
    return request(`/products/${productId}/images${q}`);
  },
  uploadProductImage: async (productId, file, variantId = null) => {
    const form = new FormData();
    form.append('file', file);
    const headers = {};
    if (authToken) headers.Authorization = `Bearer ${authToken}`;

    const params = new URLSearchParams();
    if (activeBranchId) params.set('branch_id', activeBranchId);
    if (variantId) params.set('variant_id', variantId);
    const qs = params.toString();
    const url = `${API}/products/${productId}/images${qs ? `?${qs}` : ''}`;

    const res = await fetch(url, { method: 'POST', headers, body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Ошибка загрузки');
    return data;
  },
  deleteProductImage: (productId, imageId) => request(
    `/products/${productId}/images/${imageId}`,
    { method: 'DELETE' },
  ),
  setPrimaryProductImage: (productId, imageId) => request(
    `/products/${productId}/images/${imageId}/primary`,
    { method: 'PUT' },
  ),

  getCounterparties: (type) => request(`/counterparties${type ? `?type=${type}` : ''}`),
  getCounterpartyContracts: (id) => request(`/counterparties/${id}/contracts`),
  createCounterpartyContract: (id, data) => request(`/counterparties/${id}/contracts`, { method: 'POST', body: JSON.stringify(data) }),
  deleteCounterpartyContract: (id, contractId) => request(`/counterparties/${id}/contracts/${contractId}`, { method: 'DELETE' }),
  createCounterparty: (data) => request('/counterparties', { method: 'POST', body: JSON.stringify(data) }),
  updateCounterparty: (id, data) => request(`/counterparties/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCounterparty: (id) => request(`/counterparties/${id}`, { method: 'DELETE' }),

  getDocuments: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/documents${q ? `?${q}` : ''}`);
  },
  getNextDocNumber: (type) => request(`/documents/next-number?type=${encodeURIComponent(type)}`),
  getDocument: (id) => request(`/documents/${id}`),
  createDocument: (data) => request('/documents', { method: 'POST', body: JSON.stringify(data) }),
  updateDocument: (id, data) => request(`/documents/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  confirmDocument: (id) => request(`/documents/${id}/confirm`, { method: 'POST' }),
  cancelDocument: (id) => request(`/documents/${id}/cancel`, { method: 'POST' }),
  deleteDocument: (id) => request(`/documents/${id}`, { method: 'DELETE' }),
  getDocumentHistory: (id) => request(`/documents/${id}/history`),

  getPayments: () => request('/payments'),
  getCashArticles: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/cash-articles${q ? `?${q}` : ''}`);
  },
  getCashArticlesAll: () => request('/cash-articles/all'),
  createCashArticle: (data) => request('/cash-articles', { method: 'POST', body: JSON.stringify(data) }),
  updateCashArticle: (id, data) => request(`/cash-articles/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCashArticle: (id) => request(`/cash-articles/${id}`, { method: 'DELETE' }),
  createPayment: (data) => request('/payments', { method: 'POST', body: JSON.stringify(data) }),
  updatePayment: (id, data) => request(`/payments/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePayment: (id) => request(`/payments/${id}`, { method: 'DELETE' }),

  getTelegramStatus: () => request('/telegram/status'),
  getTelegramSettings: () => request('/telegram/settings'),
  saveTelegramToken: (token) => request('/telegram/settings', { method: 'PUT', body: JSON.stringify({ token }) }),
  removeTelegramToken: () => request('/telegram/settings', { method: 'DELETE' }),
  getTelegramMessages: () => request('/telegram/messages'),
  sendTelegramMessage: (data) => request('/telegram/send', { method: 'POST', body: JSON.stringify(data) }),
  sendDocumentTelegram: (id) => request(`/telegram/send-document/${id}`, { method: 'POST' }),
};

export function formatMoney(n) {
  return new Intl.NumberFormat('ru-RU').format(n || 0) + ' сум';
}

export function formatPriceInput(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(digits));
}

export function parsePriceInput(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return null;
  return Number(digits);
}

export function formatDate(d) {
  if (!d) return '—';
  const str = String(d).slice(0, 10);
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;

  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

export const STATUS_LABELS = {
  draft: 'Черновик',
  confirmed: 'Проведён',
  cancelled: 'Отменён',
};

export const ACTION_LABELS = {
  created: 'Создан',
  updated: 'Изменён',
  confirmed: 'Проведён',
  cancelled: 'Отменён',
};
