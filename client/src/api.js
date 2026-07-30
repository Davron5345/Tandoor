import {
  getApiBaseUrl,
  getNativeSessionToken,
  isNativeApp,
  setNativeSessionToken,
} from './utils/nativeApp';

export { getApiBaseUrl };

let activeBranchId = null;

export function normalizeListResponse(data) {
  if (Array.isArray(data)) {
    return { items: data, total: data.length, page: 1, limit: data.length || 1, pages: 1 };
  }
  return {
    items: data.items || [],
    total: data.total ?? 0,
    page: data.page ?? 1,
    limit: data.limit ?? 50,
    pages: data.pages ?? 1,
    amount_sum: data.amount_sum,
  };
}

export function setActiveBranchId(id) {
  activeBranchId = id || null;
}

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const nativeToken = getNativeSessionToken();
  if (nativeToken) headers.Authorization = `Bearer ${nativeToken}`;

  let url = `${getApiBaseUrl()}/api${path}`;
  if (activeBranchId && !options.skipBranch) {
    const sep = url.includes('?') ? '&' : '?';
    url += `${sep}branch_id=${encodeURIComponent(activeBranchId)}`;
  }

  const res = await fetch(url, { credentials: 'include', ...options, headers }).catch(() => {
    throw new Error('Сервер недоступен. Проверьте подключение к интернету.');
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

async function publicRequest(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const res = await fetch(`${getApiBaseUrl()}/api${path}`, { ...options, headers }).catch(() => {
    throw new Error('Сервер недоступен. Проверьте подключение к интернету.');
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

export const api = {
  login: async (username, password, remember = false) => {
    const native = isNativeApp();
    let res;
    try {
      res = await fetch(`${getApiBaseUrl()}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(native ? { 'X-Native-Client': '1' } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          username,
          password,
          remember: !!remember,
          native,
        }),
      });
    } catch {
      throw new Error('Сервер недоступен. Запустите: npm run dev');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Неверный логин или пароль');
    if (data.token) setNativeSessionToken(data.token);
    return data;
  },
  logout: async () => {
    try {
      if (isNativeApp()) {
        const { stopBackgroundLocationTracking } = await import('./services/backgroundLocation.js');
        await stopBackgroundLocationTracking();
      }
      await request('/auth/logout', { method: 'POST' });
    } finally {
      setNativeSessionToken('');
    }
  },
  changePassword: (current_password, new_password) => request('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ current_password, new_password }),
  }),
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
  zeroStockPosition: (data) => request('/reports/stock/zero', { method: 'POST', body: JSON.stringify(data) }),
  getDebtorsReport: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/reports/debtors${q ? `?${q}` : ''}`);
  },
  getCreditorsReport: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/reports/creditors${q ? `?${q}` : ''}`);
  },
  getSupplierDebtMovementReport: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value == null || value === '') return;
      if (Array.isArray(value)) {
        if (value.length) q.set(key, value.join(','));
        return;
      }
      q.set(key, value);
    });
    const qs = q.toString();
    return request(`/reports/supplier-debts${qs ? `?${qs}` : ''}`);
  },
  getPnLReport: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/reports/pnl${q ? `?${q}` : ''}`);
  },
  getCashArticlesReport: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/reports/cash-articles${q ? `?${q}` : ''}`);
  },
  getBusinessBalance: () => request('/reports/business-balance'),
  getOpeningBalance: () => request('/opening-balance'),
  getOpeningBalanceDocuments: () => request('/opening-balance/documents'),
  getOpeningBalanceDocument: (id) => request(`/opening-balance/documents/${id}`),
  createOpeningBalanceDocument: (data) => request('/opening-balance/documents', { method: 'POST', body: JSON.stringify(data) }),
  updateOpeningBalanceDocument: (id, data) => request(`/opening-balance/documents/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  confirmOpeningBalanceDocument: (id) => request(`/opening-balance/documents/${id}/confirm`, { method: 'POST' }),
  cancelOpeningBalanceDocument: (id) => request(`/opening-balance/documents/${id}/cancel`, { method: 'POST' }),
  deleteOpeningBalanceDocument: (id) => request(`/opening-balance/documents/${id}`, { method: 'DELETE' }),
  getProductCategories: () => request('/product-categories'),
  createProductCategory: (data) => request('/product-categories', { method: 'POST', body: JSON.stringify(data) }),
  updateProductCategory: (id, data) => request(`/product-categories/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProductCategory: (id) => request(`/product-categories/${id}`, { method: 'DELETE' }),
  getUnits: () => request('/units'),
  createUnit: (data) => request('/units', { method: 'POST', body: JSON.stringify(data) }),
  updateUnit: (id, data) => request(`/units/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteUnit: (id) => request(`/units/${id}`, { method: 'DELETE' }),

  getProducts: async (params = {}) => {
    const q = new URLSearchParams(params).toString();
    const data = await request(`/products${q ? `?${q}` : ''}`);
    if (params.page || params.limit) return normalizeListResponse(data);
    return Array.isArray(data) ? data : data.items;
  },
  getProductKindCounts: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/products/kind-counts${q ? `?${q}` : ''}`);
  },
  getMyShopLayout: () => request('/myshop/layout'),
  saveMyShopLayout: (data) => request('/myshop/layout', { method: 'PUT', body: JSON.stringify(data) }),
  getShopSettings: () => request('/shop/settings'),
  saveShopSettings: (data) => request('/shop/settings', { method: 'PUT', body: JSON.stringify(data) }),
  getShopOrders: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/shop-orders${q ? `?${q}` : ''}`);
  },
  getShopOrder: (id) => request(`/shop-orders/${id}`),
  updateShopOrderStatus: (id, status) => request(`/shop-orders/${id}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  }),
  getPublicShopBranches: () => publicRequest('/public/shop/branches'),
  getPublicShopCatalog: (branchId, departmentId) => {
    const path = departmentId
      ? `/public/shop/${encodeURIComponent(branchId)}/dept/${encodeURIComponent(departmentId)}/catalog`
      : `/public/shop/${encodeURIComponent(branchId)}/catalog`;
    return publicRequest(path);
  },
  createPublicShopOrder: (branchId, data, departmentId) => {
    const path = departmentId
      ? `/public/shop/${encodeURIComponent(branchId)}/dept/${encodeURIComponent(departmentId)}/orders`
      : `/public/shop/${encodeURIComponent(branchId)}/orders`;
    return publicRequest(path, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  getProductBranchSettings: (id) => request(`/products/${id}/branch-settings`),
  createProduct: (data) => request('/products', { method: 'POST', body: JSON.stringify(data) }),
  updateProduct: (id, data) => request(`/products/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  setProductShopVisible: (id, visible) => request(`/products/${id}/shop-visible`, {
    method: 'PATCH',
    body: JSON.stringify({ visible }),
  }),
  deleteProduct: (id) => request(`/products/${id}`, { method: 'DELETE' }),
  archiveProduct: (id) => request(`/products/${id}/archive`, { method: 'POST' }),
  restoreProduct: (id) => request(`/products/${id}/restore`, { method: 'POST' }),
  archiveProductVariant: (productId, variantId) => request(
    `/products/${productId}/variants/${variantId}/archive`,
    { method: 'POST' },
  ),
  restoreProductVariant: (productId, variantId) => request(
    `/products/${productId}/variants/${variantId}/restore`,
    { method: 'POST' },
  ),
  getArchivedProductVariants: (productId) => request(`/products/${productId}/archived-variants`),

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

  getDishRecipes: () => request('/dish-recipes'),
  previewDishSale: (data) => request('/dish-sales/preview', { method: 'POST', body: JSON.stringify(data) }),

  getProductImages: (productId, variantId = null) => {
    const q = variantId ? `?variant_id=${encodeURIComponent(variantId)}` : '';
    return request(`/products/${productId}/images${q}`);
  },
  uploadProductImage: async (productId, file, variantId = null) => {
    const form = new FormData();
    form.append('file', file);

    const params = new URLSearchParams();
    if (activeBranchId) params.set('branch_id', activeBranchId);
    if (variantId) params.set('variant_id', variantId);
    const qs = params.toString();
    const url = `${getApiBaseUrl()}/api/products/${productId}/images${qs ? `?${qs}` : ''}`;

    const res = await fetch(url, { method: 'POST', credentials: 'include', body: form });
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
  getCounterpartyContracts: (id, params = {}) => {
    const q = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null)),
    ).toString();
    return request(`/counterparties/${id}/contracts${q ? `?${q}` : ''}`);
  },
  createCounterpartyContract: (id, data) => request(`/counterparties/${id}/contracts`, { method: 'POST', body: JSON.stringify(data) }),
  updateCounterpartyContract: (id, contractId, data) => request(`/counterparties/${id}/contracts/${contractId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCounterpartyContract: (id, contractId) => request(`/counterparties/${id}/contracts/${contractId}`, { method: 'DELETE' }),
  getCounterpartyFirms: (id) => request(`/counterparties/${id}/firms`),
  createCounterpartyFirm: (id, data) => request(`/counterparties/${id}/firms`, { method: 'POST', body: JSON.stringify(data) }),
  updateCounterpartyFirm: (id, firmId, data) => request(`/counterparties/${id}/firms/${firmId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCounterpartyFirm: (id, firmId) => request(`/counterparties/${id}/firms/${firmId}`, { method: 'DELETE' }),
  createCounterparty: (data) => request('/counterparties', { method: 'POST', body: JSON.stringify(data) }),
  updateCounterparty: (id, data) => request(`/counterparties/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCounterparty: (id) => request(`/counterparties/${id}`, { method: 'DELETE' }),

  getDocuments: async (params = {}) => {
    const q = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== '')),
    ).toString();
    const data = await request(`/documents${q ? `?${q}` : ''}`);
    if (params.page || params.limit) return normalizeListResponse(data);
    return Array.isArray(data) ? data : data.items;
  },
  getProductPrihodDocuments: (productId) => api.getDocuments({
    type: 'prihod',
    product_id: productId,
    status: 'confirmed',
  }),
  getNextDocNumber: (type) => request(`/documents/next-number?type=${encodeURIComponent(type)}`),
  getDocument: (id) => request(`/documents/${id}`),
  createDocument: (data) => request('/documents', { method: 'POST', body: JSON.stringify(data) }),
  updateDocument: (id, data) => request(`/documents/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  confirmDocument: (id) => request(`/documents/${id}/confirm`, { method: 'POST' }),
  cancelDocument: (id) => request(`/documents/${id}/cancel`, { method: 'POST' }),
  deleteDocument: (id) => request(`/documents/${id}`, { method: 'DELETE' }),
  getDocumentHistory: (id) => request(`/documents/${id}/history`),

  getPayments: (params = {}) => {
    const q = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== '')),
    ).toString();
    return request(`/payments${q ? `?${q}` : ''}`);
  },
  getBankOpening: (bankAccountId) => {
    const q = bankAccountId ? `?bank_account_id=${encodeURIComponent(bankAccountId)}` : '';
    return request(`/payments/bank-opening${q}`);
  },
  getBankAccounts: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/bank-accounts${q ? `?${q}` : ''}`);
  },
  createBankAccount: (data) => request('/bank-accounts', { method: 'POST', body: JSON.stringify(data) }),
  updateBankAccount: (id, data) => request(`/bank-accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteBankAccount: (id) => request(`/bank-accounts/${id}`, { method: 'DELETE' }),
  getCashShiftSummary: (date) => request(`/payments/shift-summary?date=${encodeURIComponent(date)}`),
  getCashArticles: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/cash-articles${q ? `?${q}` : ''}`);
  },
  getCashArticlesAll: () => request('/cash-articles/all'),
  createCashArticle: (data) => request('/cash-articles', { method: 'POST', body: JSON.stringify(data) }),
  updateCashArticle: (id, data) => request(`/cash-articles/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCashArticle: (id) => request(`/cash-articles/${id}`, { method: 'DELETE' }),
  parseBankStatement: async (file) => {
    const form = new FormData();
    form.append('file', file);
    const params = new URLSearchParams();
    if (activeBranchId) params.set('branch_id', activeBranchId);
    const qs = params.toString();
    const url = `${getApiBaseUrl()}/api/payments/import/parse${qs ? `?${qs}` : ''}`;
    const headers = {};
    const nativeToken = getNativeSessionToken();
    if (nativeToken) {
      headers.Authorization = `Bearer ${nativeToken}`;
      headers['X-Native-Client'] = '1';
    }
    const res = await fetch(url, { method: 'POST', credentials: 'include', headers, body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Ошибка разбора выписки');
    return data;
  },
  confirmBankStatement: (rows, options = {}) => request('/payments/import/confirm', {
    method: 'POST',
    body: JSON.stringify({
      rows: rows.map((r) => ({
        selected: r.selected,
        already_imported: r.already_imported,
        external_ref: r.external_ref,
        date: r.date,
        direction: r.direction,
        amount: r.amount,
        type: r.type,
        counterparty_id: r.counterparty_id || null,
        firm_id: r.firm_id || null,
        contract_id: r.contract_id || null,
        article_id: r.article_id || null,
        inn: r.inn || null,
        name: r.name || null,
        suggested_name: r.suggested_name || null,
        account: r.account || null,
        is_new_firm: Boolean(r.is_new_firm),
        is_new_account: Boolean(r.is_new_account),
        channel_label: r.channel_label || null,
        contract_number: r.contract_number || null,
        doc_no: r.doc_no || null,
        purpose: String(r.purpose || '').slice(0, 400),
        comment: r.comment || null,
        bank_account_id: r.bank_account_id || null,
      })),
      replace_dates: options.replace_dates || undefined,
      bank_account_id: options.bank_account_id || undefined,
    }),
  }),
  deleteBankDay: (date, bankAccountId) => {
    const q = bankAccountId ? `?bank_account_id=${encodeURIComponent(bankAccountId)}` : '';
    return request(`/payments/by-date/${encodeURIComponent(date)}${q}`, { method: 'DELETE' });
  },
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

  getAuditLog: async (params = {}) => {
    const clean = Object.fromEntries(
      Object.entries({ page: 1, limit: 50, ...params }).filter(([, v]) => v !== '' && v != null),
    );
    const q = new URLSearchParams(clean).toString();
    const data = await request(`/admin/audit-log?${q}`);
    return normalizeListResponse(data);
  },
  getAuditActions: () => request('/admin/audit-log/actions'),

  getAdminSessions: async (params = {}) => {
    const clean = Object.fromEntries(
      Object.entries({ page: 1, limit: 50, ...params }).filter(([, v]) => v !== '' && v != null),
    );
    const q = new URLSearchParams(clean).toString();
    return normalizeListResponse(await request(`/admin/sessions?${q}`));
  },
  revokeAdminSession: (id) => request(`/admin/sessions/${id}`, { method: 'DELETE' }),
  revokeUserSessions: (userId) => request(`/admin/sessions/user/${userId}`, { method: 'DELETE' }),
  blockSessionDevice: (sessionId, reason) => request(`/admin/sessions/${sessionId}/block-device`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  }),
  getBlockedDevices: async (params = {}) => {
    const clean = Object.fromEntries(
      Object.entries({ page: 1, limit: 50, ...params }).filter(([, v]) => v !== '' && v != null),
    );
    const q = new URLSearchParams(clean).toString();
    return normalizeListResponse(await request(`/admin/devices/blocked?${q}`));
  },
  unblockDevice: (id) => request(`/admin/devices/blocked/${id}`, { method: 'DELETE' }),
  getVisitLog: async (params = {}) => {
    const clean = Object.fromEntries(
      Object.entries({ page: 1, limit: 50, ...params }).filter(([, v]) => v !== '' && v != null),
    );
    const q = new URLSearchParams(clean).toString();
    return normalizeListResponse(await request(`/admin/visits?${q}`));
  },
  getVisitActions: () => request('/admin/visits/actions'),
  getMySessions: async (params = {}) => {
    const clean = Object.fromEntries(
      Object.entries({ page: 1, limit: 50, ...params }).filter(([, v]) => v !== '' && v != null),
    );
    const q = new URLSearchParams(clean).toString();
    return normalizeListResponse(await request(`/auth/sessions?${q}`));
  },
  revokeMySession: (id) => request(`/auth/sessions/${id}`, { method: 'DELETE' }),

  getPushPublicKey: () => request('/push/vapid-public-key'),
  subscribePush: (subscription) => request('/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({ subscription }),
  }),
  unsubscribePush: (endpoint) => request('/push/unsubscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint }),
  }),

  sendStaffLocation: (data) => request('/staff/location', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  getStaffLocations: (params = {}) => {
    const q = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null)),
    ).toString();
    return request(`/admin/staff-locations${q ? `?${q}` : ''}`);
  },
  getStaffLocationHistory: (params = {}) => {
    const q = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null)),
    ).toString();
    return request(`/admin/staff-locations/history${q ? `?${q}` : ''}`);
  },

  getSnabInstallInfo: () => request('/app/snab-install'),
  getSnabUpdateInfo: () => request('/app/snab-update'),

  getAdminPushSubscribers: (params = {}) => {
    const q = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null)),
    ).toString();
    return request(`/admin/push/subscribers${q ? `?${q}` : ''}`);
  },
  sendAdminPush: (data) => request('/admin/push/send', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
};

export function formatMoney(n) {
  return `${new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0)} сум`;
}

/**
 * Поле суммы/цены: пробелы тысяч, дробь через «,» или «.» (до 2 знаков).
 * Хвостовая запятая при вводе сохраняется («12,»).
 */
export function formatPriceInput(value) {
  if (value === '' || value == null) return '';
  let raw = String(value).replace(/\s/g, '');
  raw = raw.replace(/[^\d.,]/g, '');
  if (!raw) return '';

  const sepIdx = raw.search(/[.,]/);
  let intRaw = raw;
  let fracRaw = null;
  let trailingSep = false;

  if (sepIdx !== -1) {
    intRaw = raw.slice(0, sepIdx).replace(/[.,]/g, '');
    const after = raw.slice(sepIdx + 1).replace(/[.,]/g, '');
    trailingSep = after.length === 0;
    fracRaw = after.slice(0, 2);
  } else {
    intRaw = raw.replace(/[.,]/g, '');
  }

  if (intRaw === '' && !trailingSep && (fracRaw == null || fracRaw === '')) {
    return '';
  }

  const intFormatted = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
    .format(Number(intRaw || '0'));

  if (trailingSep) return `${intFormatted},`;
  if (fracRaw != null && fracRaw !== '') return `${intFormatted},${fracRaw}`;
  return intFormatted;
}

export function parsePriceInput(value) {
  if (value === '' || value == null) return null;
  let s = String(value).replace(/\s/g, '').replace(',', '.');
  s = s.replace(/[^\d.]/g, '');
  const dot = s.indexOf('.');
  if (dot !== -1) {
    s = `${s.slice(0, dot + 1)}${s.slice(dot + 1).replace(/\./g, '').slice(0, 2)}`;
  }
  if (s === '' || s === '.') return null;
  const num = Number(s);
  return Number.isFinite(num) ? num : null;
}

/** Sanitize quantity while typing: digits and one decimal separator (. or ,). */
export function normalizeQuantityInput(value) {
  if (value === '' || value == null) return '';
  let raw = String(value).replace(',', '.');
  raw = raw.replace(/[^\d.]/g, '');
  const dotIndex = raw.indexOf('.');
  if (dotIndex !== -1) {
    raw = `${raw.slice(0, dotIndex + 1)}${raw.slice(dotIndex + 1).replace(/\./g, '')}`;
  }
  return raw;
}

export function parseQuantityInput(value) {
  const raw = normalizeQuantityInput(value);
  if (raw === '' || raw === '.') return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
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

export function formatDateTime(value) {
  if (!value) return '—';
  const str = String(value);
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (match) {
    const [, y, m, d, hh = '00', mm = '00'] = match;
    return `${d}.${m}.${y} ${hh}:${mm}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const dd = String(date.getDate()).padStart(2, '0');
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${dd}.${mo}.${yyyy} ${hh}:${mm}`;
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
