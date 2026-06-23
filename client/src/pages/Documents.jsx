import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { api, formatMoney, formatDate, formatPriceInput, parsePriceInput, STATUS_LABELS, ACTION_LABELS } from '../api';
import Modal, { useToast, ModalCancelButton } from '../components/Modal';
import CategorySelect from '../components/CategorySelect';
import ProductSelect from '../components/ProductSelect';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';
import { hasPermission, DOC_TYPE_LABELS } from '../permissions';
import {
  IconButton,
  IconCheck,
  IconCopy,
  IconEye,
  IconHistory,
  IconMore,
  IconPlus,
  IconTelegram,
  IconTransfer,
  IconTrash,
  IconUndo,
  IconWallet,
} from '../components/ActionIcons';

import {
  encodeProductPick,
  getPickStock,
  resolvePickFromProducts,
} from '../utils/productVariants';
import { todayLocalIso } from '../utils/date';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import {
  useFormDraft,
  formDraftKey,
  readFormDraft,
  clearFormDraft,
  promptRestoreDraft,
} from '../hooks/useFormDraft';
import { useFormDirty } from '../hooks/useFormDirty';

const DEFAULT_CONTRACT_ID = '__default__';
const RETURN_SUPPLIER_TYPE = 'return_supplier';
const RETURN_CUSTOMER_TYPE = 'return_customer';

function isSupplierReturnType(type) {
  return type === RETURN_SUPPLIER_TYPE;
}

function isCustomerReturnType(type) {
  return type === RETURN_CUSTOMER_TYPE;
}

function isAnyReturnType(type) {
  return isSupplierReturnType(type) || isCustomerReturnType(type);
}

function isOutgoingDocType(type) {
  return type === 'rashod' || type === RETURN_SUPPLIER_TYPE;
}

function formatContractLabel(contract) {
  if (!contract?.date) return contract?.number || 'Основной договор';
  return `${contract.number} — ${formatDate(contract.date)}`;
}

const emptyItem = { product_id: '', variant_id: null, quantity: 1, price: 0 };
const emptyPayment = {
  type: 'supplier_payment',
  counterparty_id: '',
  document_id: '',
  amount: 0,
  date: todayLocalIso(),
  comment: '',
};
const emptyDoc = {
  type: 'prihod',
  counterparty_id: '',
  source_document_id: '',
  contract_id: '__default__',
  from_branch_id: '',
  to_branch_id: '',
  from_department_id: '',
  to_department_id: '',
  transfer_mode: 'branch',
  date: todayLocalIso(),
  comment: '',
  status: 'draft',
  items: [{ ...emptyItem }],
};

export default function Documents({ defaultType }) {
  const [docs, setDocs] = useState([]);
  const [products, setProducts] = useState([]);
  const [counterparties, setCounterparties] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [payments, setPayments] = useState([]);
  const [filterType, setFilterType] = useState(defaultType || '');
  const [filterStatus, setFilterStatus] = useState('');
  const [docPage, setDocPage] = useState(1);
  const [docPages, setDocPages] = useState(1);
  const [docTotal, setDocTotal] = useState(0);
  const DOC_PAGE_SIZE = 50;
  const [modal, setModal] = useState(null);
  const [paymentModal, setPaymentModal] = useState(null);
  const [paymentForm, setPaymentForm] = useState(emptyPayment);
  const [historyModal, setHistoryModal] = useState(null);
  const [history, setHistory] = useState([]);
  const [form, setForm] = useState({ ...emptyDoc, type: defaultType || 'prihod' });
  const [docProducts, setDocProducts] = useState([]);
  const [supplierContracts, setSupplierContracts] = useState([]);
  const [returnSourceDocs, setReturnSourceDocs] = useState([]);
  const [returnSourceProductMap, setReturnSourceProductMap] = useState({});
  const [returnSourceProductOptions, setReturnSourceProductOptions] = useState([]);
  const [previewDocNumber, setPreviewDocNumber] = useState('');
  const [actionsMenuId, setActionsMenuId] = useState(null);
  const [actionsMenuPos, setActionsMenuPos] = useState(null);
  const draftKey = formDraftKey('documents', modal);
  const draftPayload = useMemo(() => ({ form }), [form]);
  useFormDraft(draftKey, draftPayload, Boolean(modal));
  const isFormDirty = useFormDirty(draftPayload, draftKey);
  const { show, Toast } = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { branches, branchId } = useBranch();
  const activeBranches = branches.filter((b) => b.active);
  const canEdit = hasPermission(user, 'documents.edit');
  const canConfirm = hasPermission(user, 'documents.confirm');
  const canDelete = hasPermission(user, 'documents.delete');
  const canTelegram = hasPermission(user, 'telegram.view');
  const canPay = hasPermission(user, 'payments.edit');
  const canTransfer = hasPermission(user, 'documents.transfer') && canEdit;
  const isReadOnly = !canEdit;

  const loadDocProducts = (type, counterpartyId, departmentId) => {
    const params = { last_doc_type: type };
    if (type === 'prihod') {
      if (!counterpartyId) {
        setDocProducts([]);
        return;
      }
      params.supplier_id = counterpartyId;
      params.counterparty_id = counterpartyId;
    } else if (counterpartyId) {
      params.counterparty_id = counterpartyId;
    }
    if (departmentId) params.department_id = departmentId;
    api.getProducts(params).then(setDocProducts).catch(console.error);
  };

  useEffect(() => {
    if (!modal) return;
    const departmentId = isOutgoingDocType(form.type)
      ? form.from_department_id
      : form.type === 'prihod'
        ? form.to_department_id
        : form.type === 'peremeshchenie' && form.transfer_mode === 'department'
          ? form.from_department_id
          : null;
    loadDocProducts(form.type, form.counterparty_id, departmentId);
  }, [
    modal,
    form.type,
    form.counterparty_id,
    form.from_department_id,
    form.to_department_id,
    form.transfer_mode,
  ]);

  useEffect(() => {
    if (!modal || form.type !== 'prihod') {
      setPreviewDocNumber('');
      return;
    }
    if (modal !== 'create' && modal !== 'transfer') return;
    api.getNextDocNumber('prihod')
      .then((res) => setPreviewDocNumber(res.number || ''))
      .catch(() => setPreviewDocNumber(''));
  }, [modal, form.type, branchId]);

  useEffect(() => {
    if (!modal || form.type !== 'prihod' || !form.counterparty_id) {
      setSupplierContracts([{
        id: DEFAULT_CONTRACT_ID,
        number: 'Основной договор',
        date: null,
      }]);
      return;
    }
    api.getCounterpartyContracts(form.counterparty_id)
      .then(setSupplierContracts)
      .catch(() => setSupplierContracts([{
        id: DEFAULT_CONTRACT_ID,
        number: 'Основной договор',
        date: null,
      }]));
  }, [modal, form.type, form.counterparty_id, branchId]);

  useEffect(() => {
    if (!modal || form.type !== 'prihod' || supplierContracts.length === 0) return;
    setForm((prev) => {
      const cid = prev.contract_id || DEFAULT_CONTRACT_ID;
      if (supplierContracts.some((c) => c.id === cid)) return prev;
      return { ...prev, contract_id: supplierContracts[0].id };
    });
  }, [supplierContracts, modal, form.type]);

  useEffect(() => {
    if (!modal || !isAnyReturnType(form.type) || !form.counterparty_id) {
      setReturnSourceDocs([]);
      return;
    }
    const sourceType = isCustomerReturnType(form.type) ? 'rashod' : 'prihod';
    api.getDocuments({ type: sourceType, status: 'confirmed' })
      .then((list) => {
        const options = list
          .filter((d) => d.counterparty_id === form.counterparty_id)
          .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
        setReturnSourceDocs(options);
      })
      .catch(() => setReturnSourceDocs([]));
  }, [modal, form.type, form.counterparty_id, branchId]);

  useEffect(() => {
    if (!modal || !isAnyReturnType(form.type) || !form.source_document_id) {
      setReturnSourceProductMap({});
      setReturnSourceProductOptions([]);
      return;
    }
    api.getDocument(form.source_document_id)
      .then((doc) => {
        const sourceItems = Array.isArray(doc?.items) ? doc.items : [];
        const qtyMap = {};
        for (const item of sourceItems) {
          const key = encodeProductPick(item.product_id, item.variant_id || null);
          qtyMap[key] = (qtyMap[key] || 0) + (Number(item.quantity) || 0);
        }

        const sourceProductsById = new Map();
        for (const key of Object.keys(qtyMap)) {
          const resolved = resolvePickFromProducts(products, key);
          if (!resolved.product) continue;
          const qty = qtyMap[key];
          const existing = sourceProductsById.get(resolved.product.id);
          if (resolved.variant) {
            if (existing) {
              existing.has_variants = true;
              existing.variants = [...(existing.variants || []), { ...resolved.variant, stock: qty }];
            } else {
              sourceProductsById.set(resolved.product.id, {
                ...resolved.product,
                has_variants: true,
                variants: [{ ...resolved.variant, stock: qty }],
              });
            }
          } else {
            sourceProductsById.set(resolved.product.id, {
              ...resolved.product,
              stock: qty,
            });
          }
        }

        setReturnSourceProductMap(qtyMap);
        setReturnSourceProductOptions(Array.from(sourceProductsById.values()));
      })
      .catch(() => {
        setReturnSourceProductMap({});
        setReturnSourceProductOptions([]);
      });
  }, [modal, form.type, form.source_document_id, products]);

  const load = useCallback(() => {
    const params = { page: docPage, limit: DOC_PAGE_SIZE };
    const docType = defaultType || filterType;
    if (docType) params.type = docType;
    if (filterStatus) params.status = filterStatus;
    api.getDocuments(params).then((data) => {
      setDocs(data.items);
      setDocPages(data.pages);
      setDocTotal(data.total);
    }).catch(console.error);
  }, [defaultType, filterType, filterStatus, docPage, branchId]);

  useEffect(() => {
    Promise.all([
      api.getProducts(),
      api.getCounterparties(),
      api.getDepartments({ active: '1' }),
      hasPermission(user, 'payments.view') ? api.getPayments() : Promise.resolve([]),
    ])
      .then(([p, c, d, pay]) => {
        setProducts(p);
        setCounterparties(c);
        setDepartments(d);
        setPayments(pay);
      });
  }, [branchId, user]);

  useEffect(() => {
    setFilterType(defaultType || '');
    setDocPage(1);
  }, [defaultType]);

  useEffect(() => {
    setDocPage(1);
  }, [filterType, filterStatus, branchId]);

  useEffect(() => { load(); }, [load, branchId]);
  useAutoRefresh(load, [load, branchId], { enabled: !modal && !paymentModal });

  useEffect(() => {
    if (!actionsMenuId) return undefined;
    const close = (e) => {
      if (e.target.closest('.doc-actions-more') || e.target.closest('.doc-actions-menu')) return;
      setActionsMenuId(null);
      setActionsMenuPos(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [actionsMenuId]);

  const closeActionsMenu = () => {
    setActionsMenuId(null);
    setActionsMenuPos(null);
  };

  const toggleActionsMenu = (docId, wrapEl) => {
    if (actionsMenuId === docId) {
      closeActionsMenu();
      return;
    }
    const rect = wrapEl.getBoundingClientRect();
    setActionsMenuPos({ top: rect.bottom + 4, left: rect.right });
    setActionsMenuId(docId);
  };

  const renderExtraActions = (d) => (
    <>
      <IconButton
        title="История"
        onClick={() => { closeActionsMenu(); openHistory(d.id); }}
      >
        <IconHistory />
      </IconButton>
      {canEdit && (d.type === 'prihod' || isOutgoingDocType(d.type)) && (
        <IconButton
          title="Копировать документ"
          onClick={() => { closeActionsMenu(); openCopyDoc(d); }}
        >
          <IconCopy />
        </IconButton>
      )}
      {canConfirm && d.status === 'draft' && (
        <IconButton
          title="Провести"
          success
          onClick={() => { closeActionsMenu(); confirmDoc(d.id); }}
        >
          <IconCheck />
        </IconButton>
      )}
      {canTelegram && d.status !== 'cancelled' && d.counterparty_id && (
        <IconButton
          title="Отправить в Telegram"
          onClick={() => { closeActionsMenu(); sendTelegram(d.id); }}
        >
          <IconTelegram />
        </IconButton>
      )}
      {canEdit && d.status !== 'cancelled' && (
        <IconButton
          title="Отмена проведения"
          onClick={() => { closeActionsMenu(); cancelDoc(d.id); }}
        >
          <IconUndo />
        </IconButton>
      )}
      {canDelete && (
        <IconButton
          title="Удалить"
          danger
          onClick={() => { closeActionsMenu(); removeDoc(d); }}
        >
          <IconTrash />
        </IconButton>
      )}
    </>
  );

  const actionsMenuDoc = actionsMenuId
    ? docs.find((d) => d.id === actionsMenuId)
    : null;

  const filteredCp = counterparties.filter((c) => {
    if (form.type === 'prihod' || isSupplierReturnType(form.type)) return c.type === 'supplier';
    if (form.type === 'rashod' || isCustomerReturnType(form.type)) return c.type === 'client';
    return true;
  });

  const prihodNeedsSupplier = form.type === 'prihod' && !form.counterparty_id;
  const returnNeedsSupplier = isSupplierReturnType(form.type) && !form.counterparty_id;
  const returnNeedsClient = isCustomerReturnType(form.type) && !form.counterparty_id;
  const returnSourceDocBlocked = isAnyReturnType(form.type) && !form.source_document_id;
  const prihodNeedsDepartment = (form.type === 'prihod' || isCustomerReturnType(form.type)) && !form.to_department_id;
  const rashodNeedsDepartment = isOutgoingDocType(form.type) && !form.from_department_id;
  const prihodBlocked = prihodNeedsSupplier || (form.type === 'prihod' && prihodNeedsDepartment);
  const customerReturnBlocked = returnNeedsClient || (isCustomerReturnType(form.type) && prihodNeedsDepartment);
  const rashodBlocked = returnNeedsSupplier || rashodNeedsDepartment || returnSourceDocBlocked;
  const itemsBlocked = prihodBlocked || rashodBlocked || customerReturnBlocked;
  const selectedReturnSourceDoc = isAnyReturnType(form.type)
    ? (returnSourceDocs.find((d) => d.id === form.source_document_id) || null)
    : null;
  const returnDateTooEarly = !!(
    isAnyReturnType(form.type)
    && selectedReturnSourceDoc?.date
    && form.date
    && form.date < selectedReturnSourceDoc.date.slice(0, 10)
  );
  const selectableProducts = useMemo(
    () => (isAnyReturnType(form.type)
      ? (returnSourceDocBlocked ? [] : returnSourceProductOptions)
      : docProducts),
    [form.type, returnSourceDocBlocked, returnSourceProductOptions, docProducts],
  );
  const isDepartmentTransfer = form.type === 'peremeshchenie' && form.transfer_mode === 'department';
  const docBranchForDept = branchId || 'main';
  const transferBranchId = form.from_branch_id || docBranchForDept;
  const branchDepartments = departments.filter(
    (d) => d.active && d.branch_id === transferBranchId,
  );
  const prihodDepartments = departments.filter(
    (d) => d.active && d.branch_id === docBranchForDept,
  );

  const getDocPaid = (docId) => payments
    .filter((p) => p.document_id === docId)
    .reduce((sum, p) => sum + (p.amount || 0), 0);

  const getDocRemaining = (doc) => Math.max(0, (doc.total_amount || 0) - getDocPaid(doc.id));

  const handleTransferModeChange = (mode) => {
    if (mode === 'department') {
      const branch = form.from_branch_id || branchId || 'main';
      setForm({
        ...form,
        transfer_mode: 'department',
        from_branch_id: branch,
        to_branch_id: branch,
        from_department_id: '',
        to_department_id: '',
      });
      return;
    }
    setForm({
      ...form,
      transfer_mode: 'branch',
      from_department_id: '',
      to_department_id: '',
      to_branch_id: '',
    });
  };

  const handleSupplierChange = (counterpartyId) => {
    const items = form.items.map((item) => ({ ...item, product_id: '' }));
    setForm({
      ...form,
      counterparty_id: counterpartyId,
      source_document_id: '',
      contract_id: DEFAULT_CONTRACT_ID,
      items,
    });
  };

  const handleTypeChange = (type) => {
    setForm({
      ...form,
      type,
      counterparty_id: '',
      source_document_id: '',
      contract_id: DEFAULT_CONTRACT_ID,
      to_department_id: '',
      from_department_id: '',
      items: [{ ...emptyItem }],
    });
  };

  const applyDocumentDraft = useCallback((modalKey, defaultForm) => {
    const key = formDraftKey('documents', modalKey);
    const draft = readFormDraft(key);
    if (draft?.form && promptRestoreDraft(draft, 'черновик документа')) {
      return draft.form;
    }
    if (draft) clearFormDraft(key);
    return defaultForm;
  }, []);

  const openCreate = (type) => {
    if (isReadOnly) return;
    const docType = type || defaultType || 'prihod';
    setForm(applyDocumentDraft('create', {
      ...emptyDoc,
      type: docType,
      from_branch_id: branchId || 'main',
      to_branch_id: '',
      transfer_mode: docType === 'peremeshchenie' ? 'branch' : 'branch',
      items: [{ ...emptyItem }],
    }));
    setModal('create');
  };

  const openTransferFromDoc = async (doc) => {
    if (!canTransfer) return;
    const full = await api.getDocument(doc.id);
    const sourceBranch = full.branch_id || branchId || 'main';
    setForm(applyDocumentDraft('transfer', {
      ...emptyDoc,
      type: 'peremeshchenie',
      transfer_mode: 'branch',
      from_branch_id: sourceBranch,
      to_branch_id: '',
      from_department_id: '',
      to_department_id: '',
      date: todayLocalIso(),
      comment: `Перемещение по документу №${full.number}`,
      status: 'draft',
      items: full.items.map((i) => ({
        product_id: i.product_id,
        variant_id: i.variant_id || null,
        quantity: i.quantity,
        price: i.price,
      })),
    }));
    setModal('transfer');
  };

  const openCopyDoc = async (doc) => {
    if (isReadOnly) return;
    const full = await api.getDocument(doc.id);
    setForm(applyDocumentDraft('create', {
      ...emptyDoc,
      type: full.type,
      counterparty_id: full.counterparty_id || '',
      source_document_id: full.source_document_id || '',
      contract_id: full.contract_id || DEFAULT_CONTRACT_ID,
      to_department_id: full.type === 'prihod' ? (full.to_department_id || '') : '',
      from_department_id: isOutgoingDocType(full.type) ? (full.from_department_id || '') : '',
      date: todayLocalIso(),
      comment: `Копия документа №${full.number}`,
      status: 'draft',
      items: [{ ...emptyItem }],
    }));
    setModal('create');
  };

  const openPay = (doc) => {
    if (!canPay || !doc.counterparty_id) return;
    const remaining = getDocRemaining(doc);
    if (remaining <= 0) {
      show('Документ уже полностью оплачен', 'error');
      return;
    }
    setPaymentForm({
      type: doc.type === 'prihod' ? 'supplier_payment' : 'customer_income',
      counterparty_id: doc.counterparty_id,
      document_id: doc.id,
      amount: remaining,
      date: todayLocalIso(),
      comment: `Оплата по документу №${doc.number}`,
    });
    setPaymentModal(doc);
  };

  const savePayment = async () => {
    try {
      if (!paymentForm.amount || paymentForm.amount <= 0) {
        show('Укажите сумму больше нуля', 'error');
        return;
      }
      await api.createPayment(paymentForm);
      show('Оплата добавлена');
      setPaymentModal(null);
      const pay = await api.getPayments();
      setPayments(pay);
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const openEdit = async (id, docType) => {
    if (docType === 'opening_balance') {
      navigate('/opening-balance');
      return;
    }
    const doc = await api.getDocument(id);
    const loadedForm = {
      ...doc,
      contract_id: doc.contract_id || DEFAULT_CONTRACT_ID,
      from_branch_id: doc.from_branch_id || doc.branch_id || '',
      to_branch_id: doc.to_branch_id || '',
      from_department_id: doc.from_department_id || '',
      to_department_id: doc.to_department_id || '',
      transfer_mode: (doc.from_department_id || doc.to_department_id) ? 'department' : 'branch',
      items: doc.items.map((i) => ({
        product_id: i.product_id,
        variant_id: i.variant_id || null,
        quantity: i.quantity,
        price: i.price,
      })),
    };
    setForm(applyDocumentDraft(id, loadedForm));
    setModal(id);
  };

  const openHistory = async (id) => {
    const h = await api.getDocumentHistory(id);
    setHistory(h);
    setHistoryModal(id);
  };

  const addItemAfter = (idx) => {
    const items = [...form.items];
    items.splice(idx + 1, 0, { ...emptyItem });
    setForm({ ...form, items });
  };

  const removeItem = (idx) => {
    if (form.items.length <= 1) return;
    setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });
  };

  const resolveProductPrice = (product, variant = null) => {
    if (variant) {
      if (variant.last_price != null && variant.last_price !== '') return variant.last_price;
      if (variant.avg_cost != null && variant.avg_cost > 0) return variant.avg_cost;
      return variant.price ?? 0;
    }
    if (!product) return 0;
    if (product.last_price != null && product.last_price !== '') return product.last_price;
    if (product.avg_cost != null && product.avg_cost > 0) return product.avg_cost;
    return product.price ?? 0;
  };

  const updateItemProductPick = (idx, pickValue) => {
    const catalog = selectableProducts.length ? selectableProducts : products;
    const resolved = resolvePickFromProducts(catalog, pickValue);
    const items = [...form.items];
    items[idx] = {
      ...items[idx],
      product_id: resolved.productId,
      variant_id: resolved.variantId,
    };
    if (resolved.product) {
      items[idx].price = resolved.variant
        ? resolveProductPrice(resolved.product, resolved.variant)
        : resolveProductPrice(resolved.product);
    }
    setForm({ ...form, items });
  };

  const updateItem = (idx, field, value) => {
    const items = [...form.items];
    items[idx] = { ...items[idx], [field]: value };
    setForm({ ...form, items });
  };

  const total = form.items.reduce(
    (s, i) => s + (Number(i.quantity) || 0) * (Number(i.price) || 0),
    0,
  );

  const transferStockWarnings = useMemo(() => {
    if (form.type !== 'peremeshchenie' || isReadOnly || form.status !== 'draft') return [];
    const fromDepartment = isDepartmentTransfer && form.from_department_id;
    return form.items.flatMap((item, idx) => {
      if (!item.product_id || !(Number(item.quantity) > 0)) return [];
      const catalog = selectableProducts.length ? selectableProducts : products;
      const resolved = resolvePickFromProducts(
        catalog,
        encodeProductPick(item.product_id, item.variant_id),
      );
      const { product, variant } = resolved;
      if (!product || product.stock == null) return [];
      const stock = getPickStock(product, variant);
      if (Number(item.quantity) <= stock) return [];
      return [{
        idx,
        name: variant ? `${product.name} — ${variant.name}` : product.name,
        stock,
        quantity: item.quantity,
        unit: product.unit || 'шт',
        fromDepartment,
      }];
    });
  }, [
    form.items,
    form.type,
    form.status,
    form.from_department_id,
    selectableProducts,
    products,
    isReadOnly,
    isDepartmentTransfer,
  ]);

  const hasTransferStockOverflow = transferStockWarnings.length > 0;

  const save = async (confirm = false) => {
    if (isReadOnly) return;
    try {
      if (form.type === 'prihod' && !form.counterparty_id) {
        show('Выберите поставщика', 'error');
        return;
      }
      if (isSupplierReturnType(form.type) && !form.counterparty_id) {
        show('Выберите поставщика для возврата', 'error');
        return;
      }
      if (isCustomerReturnType(form.type) && !form.counterparty_id) {
        show('Выберите клиента для возврата', 'error');
        return;
      }
      if (isAnyReturnType(form.type) && !form.source_document_id) {
        show(isCustomerReturnType(form.type) ? 'Выберите расходный документ' : 'Выберите приходный документ', 'error');
        return;
      }
      if (returnDateTooEarly) {
        show(isCustomerReturnType(form.type)
          ? 'Дата возврата не может быть раньше даты расходного документа'
          : 'Дата возврата не может быть раньше даты приходного документа', 'error');
        return;
      }
      if (form.type === 'prihod' && !form.to_department_id) {
        show('Выберите отдел', 'error');
        return;
      }
      if (isCustomerReturnType(form.type) && !form.to_department_id) {
        show('Выберите отдел для оприходования возврата', 'error');
        return;
      }
      if (isOutgoingDocType(form.type) && !form.from_department_id) {
        show('Выберите отдел', 'error');
        return;
      }
      const items = form.items.filter((i) => i.product_id);
      if (items.length === 0) {
        show('Добавьте хотя бы один товар', 'error');
        return;
      }
      if (items.some((i) => !(Number(i.quantity) > 0))) {
        show('Укажите количество больше нуля', 'error');
        return;
      }
      if (form.type === 'peremeshchenie' && hasTransferStockOverflow) {
        const w = transferStockWarnings[0];
        const where = w.fromDepartment ? 'в отделе' : 'на филиале';
        show(`Недостаточно «${w.name}»: указано ${w.quantity} ${w.unit}, ${where} ${w.stock} ${w.unit}`, 'error');
        return;
      }
      if (form.type === 'peremeshchenie') {
        if (form.transfer_mode === 'department') {
          if (!form.to_department_id && !form.from_department_id) {
            show('Укажите отдел отправления или получения', 'error');
            return;
          }
          if (form.from_department_id && form.to_department_id && form.from_department_id === form.to_department_id) {
            show('Отделы должны отличаться', 'error');
            return;
          }
        } else if (!form.from_branch_id || !form.to_branch_id) {
          show('Укажите филиалы отправления и получения', 'error');
          return;
        } else if (form.from_branch_id === form.to_branch_id) {
          show('Филиалы должны отличаться', 'error');
          return;
        }
      }
      const data = {
        type: form.type,
        counterparty_id: form.type === 'peremeshchenie' ? null : (form.counterparty_id || null),
        source_document_id: isAnyReturnType(form.type) ? (form.source_document_id || null) : null,
        from_branch_id: null,
        to_branch_id: null,
        from_department_id: null,
        to_department_id: null,
        date: form.date,
        comment: form.comment || '',
        status: confirm ? 'confirmed' : form.status,
        items: items.map((i) => ({
          product_id: i.product_id,
          variant_id: i.variant_id || null,
          quantity: Number(i.quantity) || 0,
          price: Number(i.price) || 0,
        })),
      };
      if (form.type === 'peremeshchenie') {
        if (form.transfer_mode === 'department') {
          const branch = form.from_branch_id || branchId || 'main';
          data.from_branch_id = branch;
          data.to_branch_id = branch;
          data.from_department_id = form.from_department_id || null;
          data.to_department_id = form.to_department_id || null;
        } else {
          data.from_branch_id = form.from_branch_id;
          data.to_branch_id = form.to_branch_id;
        }
      } else if (form.type === 'prihod' || isCustomerReturnType(form.type)) {
        data.to_department_id = form.to_department_id;
        if (form.type === 'prihod') {
          data.contract_id = form.contract_id || DEFAULT_CONTRACT_ID;
        }
      } else if (isOutgoingDocType(form.type)) {
        data.from_department_id = form.from_department_id;
      }
      if (modal === 'create' || modal === 'transfer') {
        await api.createDocument(data);
        show(confirm ? 'Документ создан и проведён' : 'Документ создан');
      } else {
        await api.updateDocument(modal, data);
        show('Документ обновлён');
      }
      clearFormDraft(draftKey);
      setModal(null);
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const confirmDoc = async (id) => {
    try {
      await api.confirmDocument(id);
      show('Документ проведён, уведомление отправлено в Telegram');
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const cancelDoc = async (id) => {
    if (!window.confirm('Отменить документ?')) return;
    try {
      await api.cancelDocument(id);
      show('Документ отменён');
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const removeDoc = async (doc) => {
    const typeLabel = doc.type === 'prihod' ? 'Приход' : 'Расход';
    const msg = `Удалить документ №${doc.number} (${typeLabel}) полностью?\n\nЭто действие нельзя отменить. Документ будет удалён из базы данных.`;
    if (!window.confirm(msg)) return;
    try {
      await api.deleteDocument(doc.id);
      show(`Документ №${doc.number} удалён`);
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const sendTelegram = async (id) => {
    try {
      await api.sendDocumentTelegram(id);
      show('Сообщение отправлено в Telegram');
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const title = defaultType === 'prihod' ? 'Приход'
    : defaultType === 'rashod' ? 'Расход'
    : defaultType === RETURN_SUPPLIER_TYPE ? 'Возврат поставщику'
    : defaultType === RETURN_CUSTOMER_TYPE ? 'Возврат от клиента'
    : defaultType === 'peremeshchenie' ? 'Перемещение'
    : 'Журнал документов';

  const typeLabel = (type) => DOC_TYPE_LABELS[type] || type;

  const docBranchLabel = (d) => {
    if (d.type === 'peremeshchenie') {
      if (d.from_department_id || d.to_department_id) {
        const from = d.from_department_name || 'Склад';
        const to = d.to_department_name || 'Склад';
        return `${d.branch_name || d.from_branch_name || '—'}: ${from} → ${to}`;
      }
      const from = d.from_branch_name || d.from_branch_id || '?';
      const to = d.to_branch_name || d.to_branch_id || '?';
      return `${from} → ${to}`;
    }
    if (d.type === 'prihod' && d.to_department_name) {
      return `${d.branch_name || '—'} · ${d.to_department_name}`;
    }
    if (isCustomerReturnType(d.type) && d.to_department_name) {
      return `${d.branch_name || '—'} · ${d.to_department_name}`;
    }
    if (isOutgoingDocType(d.type) && d.from_department_name) {
      return `${d.branch_name || '—'} · ${d.from_department_name}`;
    }
    if (d.type === 'razdelka') {
      const from = d.from_department_name || '—';
      const to = d.to_department_name || '—';
      return `${from} → ${to}`;
    }
    return d.branch_name || '—';
  };

  const docTypeCreateLabel = {
    prihod: 'Новый приходный документ',
    rashod: 'Новый расходный документ',
    return_supplier: 'Новый возврат поставщику',
    return_customer: 'Новый возврат от клиента',
    peremeshchenie: 'Новое перемещение',
  };

  const modalTitle = modal === 'transfer'
    ? 'Перемещение по документу'
    : modal === 'create'
      ? (docTypeCreateLabel[form.type] || docTypeCreateLabel[defaultType] || 'Новый документ')
      : (isReadOnly ? 'Просмотр документа' : 'Редактирование документа');

  const visibleDocs = defaultType
    ? docs.filter((d) => d.type === defaultType)
    : docs;

  return (
    <div>
      {Toast}
      <div className="page-header">
        <h1>{title}</h1>
        <div className="btn-group">
          {!defaultType && canEdit && (
            <>
              <button type="button" className="btn btn-prihod" onClick={() => openCreate('prihod')}>+ Приход</button>
              <button type="button" className="btn btn-rashod" onClick={() => openCreate('rashod')}>+ Расход</button>
              <button type="button" className="btn btn-rashod" onClick={() => openCreate(RETURN_SUPPLIER_TYPE)}>+ Возврат поставщику</button>
              <button type="button" className="btn btn-rashod" onClick={() => openCreate(RETURN_CUSTOMER_TYPE)}>+ Возврат от клиента</button>
            </>
          )}
          {defaultType && canEdit && (
            <button className="btn btn-primary" onClick={() => openCreate(defaultType)}>
              Новый
            </button>
          )}
        </div>
      </div>

      {!defaultType && (
        <div className="filters">
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="">Все типы</option>
            <option value="prihod">Приход</option>
            <option value="rashod">Расход</option>
            <option value="return_supplier">Возврат поставщику</option>
            <option value="return_customer">Возврат от клиента</option>
            <option value="peremeshchenie">Перемещение</option>
            <option value="razdelka">Разделка</option>
            <option value="dish_sale">Продажа блюд</option>
            <option value="opening_balance">Начальное сальдо</option>
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">Все статусы</option>
            <option value="draft">Черновик</option>
            <option value="confirmed">Проведён</option>
            <option value="cancelled">Отменён</option>
          </select>
        </div>
      )}

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Номер</th>
                <th>Дата</th>
                <th>Тип</th>
                <th>Контрагент</th>
                <th>Сумма</th>
                <th>Статус</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {visibleDocs.map((d) => (
                <tr key={d.id}>
                  <td>{d.number}</td>
                  <td>{formatDate(d.date)}</td>
                  <td>
                    <span className={`badge badge-${d.type === 'peremeshchenie' ? 'supplier' : ((d.type === RETURN_SUPPLIER_TYPE || d.type === RETURN_CUSTOMER_TYPE) ? 'rashod' : d.type)}`}>
                      {typeLabel(d.type)}
                    </span>
                  </td>
                  <td>{d.counterparty_name || docBranchLabel(d) || '—'}</td>
                  <td>{formatMoney(d.total_amount)}</td>
                  <td><span className={`badge badge-${d.status}`}>{STATUS_LABELS[d.status]}</span></td>
                  <td>
                    <div className="btn-group btn-group-icons doc-actions">
                      <IconButton
                        title={isReadOnly ? 'Просмотр' : 'Открыть'}
                        onClick={() => openEdit(d.id, d.type)}
                      >
                        <IconEye />
                      </IconButton>
                      {canTransfer && d.status === 'confirmed' && d.type === 'prihod' && (
                        <IconButton title="Перемещение" onClick={() => openTransferFromDoc(d)}>
                          <IconTransfer />
                        </IconButton>
                      )}
                      {canPay && d.status === 'confirmed'
                        && (d.type === 'prihod' || d.type === 'rashod')
                        && d.counterparty_id
                        && getDocRemaining(d) > 0 && (
                        <IconButton title="Оплатить" onClick={() => openPay(d)}>
                          <IconWallet />
                        </IconButton>
                      )}
                      <div className="doc-actions-more">
                        <IconButton
                          title="Ещё"
                          onClick={(e) => toggleActionsMenu(d.id, e.currentTarget.closest('.doc-actions-more'))}
                        >
                          <IconMore />
                        </IconButton>
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
              {docs.length === 0 && (
                <tr><td colSpan={7} className="empty">Нет документов</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {docPages > 1 && (
          <div className="table-pagination" style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 16px', justifyContent: 'flex-end' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>
              {docTotal} документов · стр. {docPage} из {docPages}
            </span>
            <button type="button" className="btn btn-ghost" disabled={docPage <= 1} onClick={() => setDocPage((p) => p - 1)}>
              ← Назад
            </button>
            <button type="button" className="btn btn-ghost" disabled={docPage >= docPages} onClick={() => setDocPage((p) => p + 1)}>
              Вперёд →
            </button>
          </div>
        )}
      </div>

      {modal && (
        <Modal
          className="modal-doc"
          title={modalTitle}
          dirty={isFormDirty}
          onClose={() => {
            clearFormDraft(draftKey);
            setModal(null);
          }}
          footer={
            <>
              <ModalCancelButton>Закрыть</ModalCancelButton>
              {canEdit && (
                <>
                  <button className="btn btn-ghost" onClick={() => save(false)} disabled={hasTransferStockOverflow}>Сохранить</button>
                  {form.status === 'draft' && canConfirm && (
                    <button className="btn btn-success" onClick={() => save(true)} disabled={hasTransferStockOverflow}>Провести</button>
                  )}
                </>
              )}
            </>
          }
        >
          <div className="doc-modal">
            <div className="doc-modal-fields">
              {form.type === 'prihod' && !form.counterparty_id && !isReadOnly && (
                <div className="alert alert-error" style={{ marginBottom: 12 }}>
                  Сначала выберите поставщика — затем появятся только его товары.
                </div>
              )}
              {form.type === RETURN_SUPPLIER_TYPE && !form.counterparty_id && !isReadOnly && (
                <div className="alert alert-error" style={{ marginBottom: 12 }}>
                  Для возврата сначала выберите поставщика.
                </div>
              )}
              {form.type === RETURN_SUPPLIER_TYPE && form.counterparty_id && returnSourceDocs.length === 0 && (
                <div className="alert alert-error" style={{ marginBottom: 12 }}>
                  Для этого поставщика нет проведённых приходов в текущем филиале.
                </div>
              )}
              {isCustomerReturnType(form.type) && !form.counterparty_id && !isReadOnly && (
                <div className="alert alert-error" style={{ marginBottom: 12 }}>
                  Для возврата сначала выберите клиента.
                </div>
              )}
              {isCustomerReturnType(form.type) && form.counterparty_id && returnSourceDocs.length === 0 && (
                <div className="alert alert-error" style={{ marginBottom: 12 }}>
                  Для этого клиента нет проведённых расходов в текущем филиале.
                </div>
              )}
              {isAnyReturnType(form.type) && form.source_document_id && returnSourceProductOptions.length === 0 && (
                <div className="alert alert-error" style={{ marginBottom: 12 }}>
                  {isCustomerReturnType(form.type)
                    ? 'В выбранном расходном документе нет товарных позиций для возврата.'
                    : 'В выбранном приходном документе нет товарных позиций для возврата.'}
                </div>
              )}
              {isAnyReturnType(form.type) && returnDateTooEarly && (
                <div className="alert alert-error" style={{ marginBottom: 12 }}>
                  {isCustomerReturnType(form.type)
                    ? 'Дата возврата не может быть раньше даты расходного документа.'
                    : 'Дата возврата не может быть раньше даты приходного документа.'}
                </div>
              )}
              {form.type === 'prihod' && form.counterparty_id && docProducts.length === 0 && (
                <div className="alert alert-error" style={{ marginBottom: 12 }}>
                  У выбранного поставщика нет привязанных товаров. Назначьте поставщиков в карточке товара.
                </div>
              )}
              {(form.type === 'prihod' || isCustomerReturnType(form.type)) && !form.to_department_id && !isReadOnly && (
                <div className="alert alert-error" style={{ marginBottom: 12 }}>
                  {isCustomerReturnType(form.type)
                    ? 'Выберите отдел — возвращённый товар будет оприходован в этот отдел.'
                    : 'Выберите отдел — товар будет оприходован в этот отдел.'}
                </div>
              )}
              {isOutgoingDocType(form.type) && !form.from_department_id && !isReadOnly && (
                <div className="alert alert-error" style={{ marginBottom: 12 }}>
                  Выберите отдел — расход/возврат будет списан из остатка этого отдела.
                </div>
              )}
              <div className="form-grid">
                {!defaultType && (
                  <div className="form-group">
                    <label>Тип</label>
                    <select
                      value={form.type}
                      disabled={modal !== 'create' || modal === 'transfer'}
                      onChange={(e) => handleTypeChange(e.target.value)}
                    >
                      <option value="prihod">Приход</option>
                      <option value="rashod">Расход</option>
                      <option value="return_supplier">Возврат поставщику</option>
            <option value="return_customer">Возврат от клиента</option>
                      <option value="peremeshchenie">Перемещение</option>
                    </select>
                  </div>
                )}
                {form.type === 'prihod' || isCustomerReturnType(form.type) ? (
                  <>
                    <div className="form-group">
                      <label>Дата</label>
                      <input
                        type="date"
                        value={form.date}
                        min={isAnyReturnType(form.type) ? (selectedReturnSourceDoc?.date?.slice(0, 10) || undefined) : undefined}
                        onChange={(e) => setForm({ ...form, date: e.target.value })}
                        disabled={isReadOnly}
                      />
                    </div>
                    <div className="form-group">
                      <label>Номер документа</label>
                      <input value={form.number || previewDocNumber || '—'} disabled />
                    </div>
                    <div className="form-group">
                      <label>{isCustomerReturnType(form.type) ? 'Клиент' : 'Поставщик'}</label>
                      <CategorySelect
                        categories={filteredCp}
                        value={form.counterparty_id}
                        onChange={handleSupplierChange}
                        tree={false}
                        includeEmpty
                        emptyLabel="— не выбран —"
                        placeholder="— не выбран —"
                        searchPlaceholder={isCustomerReturnType(form.type) ? 'Поиск клиента...' : 'Поиск поставщика...'}
                        disabled={isReadOnly}
                      />
                    </div>
                    {form.type === 'prihod' && (
                      <div className="form-group">
                        <label>Договор</label>
                        <select
                          value={form.contract_id || DEFAULT_CONTRACT_ID}
                          onChange={(e) => setForm({ ...form, contract_id: e.target.value })}
                          disabled={isReadOnly || !form.counterparty_id}
                        >
                          {supplierContracts.map((c) => (
                            <option key={c.id} value={c.id}>{formatContractLabel(c)}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    {isCustomerReturnType(form.type) && (
                      <div className="form-group">
                        <label>Расходный документ *</label>
                        <select
                          value={form.source_document_id || ''}
                          onChange={(e) => setForm({
                            ...form,
                            source_document_id: e.target.value,
                            date: (() => {
                              const picked = returnSourceDocs.find((d) => d.id === e.target.value);
                              if (!picked?.date) return form.date;
                              const pickedDate = picked.date.slice(0, 10);
                              return form.date && form.date >= pickedDate ? form.date : pickedDate;
                            })(),
                            items: form.items.map((it) => ({ ...it, product_id: '', variant_id: null })),
                          })}
                          disabled={isReadOnly || !form.counterparty_id}
                          required
                        >
                          <option value="">— выберите —</option>
                          {returnSourceDocs.map((d) => (
                            <option key={d.id} value={d.id}>
                              №{d.number} от {formatDate(d.date)} · {formatMoney(d.total_amount)}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="form-group">
                      <label>Отдел *</label>
                      <select
                        value={form.to_department_id || ''}
                        onChange={(e) => setForm({ ...form, to_department_id: e.target.value })}
                        disabled={isReadOnly}
                        required
                      >
                        <option value="">— выберите —</option>
                        {prihodDepartments.map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </div>
                  </>
                ) : form.type === 'peremeshchenie' ? (
                  <>
                    <div className="form-group">
                      <label>Дата</label>
                      <input
                        type="date"
                        value={form.date}
                        min={form.type === RETURN_SUPPLIER_TYPE ? (selectedReturnSourceDoc?.date || undefined) : undefined}
                        onChange={(e) => setForm({ ...form, date: e.target.value })}
                        disabled={isReadOnly}
                      />
                    </div>
                    <div className="form-group full">
                      <label>Тип перемещения</label>
                      <select
                        value={form.transfer_mode || 'branch'}
                        disabled={isReadOnly}
                        onChange={(e) => handleTransferModeChange(e.target.value)}
                      >
                        <option value="branch">Между филиалами</option>
                        <option value="department">Между отделами</option>
                      </select>
                    </div>
                    {isDepartmentTransfer ? (
                      <>
                        <div className="form-group">
                          <label>Филиал *</label>
                          <select
                            value={form.from_branch_id || ''}
                            onChange={(e) => setForm({
                              ...form,
                              from_branch_id: e.target.value,
                              to_branch_id: e.target.value,
                              from_department_id: '',
                              to_department_id: '',
                            })}
                            disabled={isReadOnly}
                          >
                            {activeBranches.map((b) => (
                              <option key={b.id} value={b.id}>{b.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="form-group">
                          <label>Откуда (отдел)</label>
                          <select
                            value={form.from_department_id || ''}
                            onChange={(e) => setForm({ ...form, from_department_id: e.target.value })}
                            disabled={isReadOnly}
                          >
                            <option value="">— общий склад —</option>
                            {branchDepartments.map((d) => (
                              <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="form-group">
                          <label>Куда (отдел) *</label>
                          <select
                            value={form.to_department_id || ''}
                            onChange={(e) => setForm({ ...form, to_department_id: e.target.value })}
                            disabled={isReadOnly}
                          >
                            <option value="">— выберите —</option>
                            {branchDepartments.map((d) => (
                              <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                          </select>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="form-group">
                          <label>Откуда (филиал) *</label>
                          <select
                            value={form.from_branch_id || ''}
                            onChange={(e) => setForm({ ...form, from_branch_id: e.target.value })}
                            disabled={isReadOnly}
                          >
                            <option value="">— выберите —</option>
                            {activeBranches.map((b) => (
                              <option key={b.id} value={b.id}>{b.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="form-group">
                          <label>Куда (филиал) *</label>
                          <select
                            value={form.to_branch_id || ''}
                            onChange={(e) => setForm({ ...form, to_branch_id: e.target.value })}
                            disabled={isReadOnly}
                          >
                            <option value="">— выберите —</option>
                            {activeBranches.map((b) => (
                              <option key={b.id} value={b.id}>{b.name}</option>
                            ))}
                          </select>
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <div className="form-group">
                      <label>Дата</label>
                      <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} disabled={isReadOnly} />
                    </div>
                    <div className="form-group">
                      <label>{isSupplierReturnType(form.type) ? 'Поставщик' : 'Клиент'}</label>
                      <CategorySelect
                        categories={filteredCp}
                        value={form.counterparty_id}
                        onChange={handleSupplierChange}
                        tree={false}
                        includeEmpty
                        emptyLabel="— не выбран —"
                        placeholder="— не выбран —"
                        searchPlaceholder={isSupplierReturnType(form.type) ? 'Поиск поставщика...' : 'Поиск клиента...'}
                        disabled={isReadOnly}
                      />
                    </div>
                    {isSupplierReturnType(form.type) && (
                      <div className="form-group">
                        <label>Приходный документ *</label>
                        <select
                          value={form.source_document_id || ''}
                          onChange={(e) => setForm({
                            ...form,
                            source_document_id: e.target.value,
                            date: (() => {
                              const picked = returnSourceDocs.find((d) => d.id === e.target.value);
                              if (!picked?.date) return form.date;
                              return form.date && form.date >= picked.date ? form.date : picked.date;
                            })(),
                            items: form.items.map((it) => ({ ...it, product_id: '', variant_id: null })),
                          })}
                          disabled={isReadOnly || !form.counterparty_id}
                          required
                        >
                          <option value="">— выберите —</option>
                          {returnSourceDocs.map((d) => (
                            <option key={d.id} value={d.id}>
                              №{d.number} от {formatDate(d.date)} · {formatMoney(d.total_amount)}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="form-group">
                      <label>Отдел *</label>
                      <select
                        value={form.from_department_id || ''}
                        onChange={(e) => setForm({ ...form, from_department_id: e.target.value })}
                        disabled={isReadOnly}
                        required
                      >
                        <option value="">— выберите —</option>
                        {prihodDepartments.map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="doc-modal-items">
              {hasTransferStockOverflow && (
                <div className="alert alert-error razdelka-stock-alert">
                  {transferStockWarnings.map((w) => (
                    <div key={w.idx}>
                      Недостаточно «{w.name}»: указано {w.quantity} {w.unit},{' '}
                      {w.fromDepartment ? 'в отделе' : 'на филиале'} только {w.stock} {w.unit}
                    </div>
                  ))}
                </div>
              )}
              <div className="table-wrap items-table doc-items-table doc-items-table-numbered doc-modal-items-scroll">
                <table>
                  <thead>
                    <tr>
                      <th className="doc-items-num-col">№</th>
                      <th>Товар</th>
                      <th>Кол-во</th>
                      <th>Цена</th>
                      <th>Сумма</th>
                      <th className="doc-items-actions-col" aria-label="Действия" />
                    </tr>
                  </thead>
                  <tbody>
                    {form.items.map((item, idx) => {
                      const rowTransferWarning = transferStockWarnings.find((w) => w.idx === idx);
                      return (
                      <tr key={idx} className={rowTransferWarning ? 'razdelka-row-overstock' : undefined}>
                        <td className="doc-items-num-col">{idx + 1}</td>
                        <td>
                          <ProductSelect
                            products={selectableProducts}
                            allProducts={isAnyReturnType(form.type)
                              ? (selectableProducts.length ? selectableProducts : products)
                              : products}
                            value={encodeProductPick(item.product_id, item.variant_id)}
                            onChange={(pickValue) => updateItemProductPick(idx, pickValue)}
                            disabled={itemsBlocked || isReadOnly}
                            placeholder={
                              prihodNeedsSupplier
                                ? 'Сначала выберите поставщика'
                                : returnNeedsSupplier
                                  ? 'Сначала выберите поставщика для возврата'
                                  : returnSourceDocBlocked
                                    ? 'Сначала выберите приходный документ'
                                : prihodNeedsDepartment
                                  ? 'Сначала выберите отдел'
                                  : rashodNeedsDepartment
                                    ? 'Сначала выберите отдел'
                                  : 'Выберите товар...'
                            }
                          />
                          {isAnyReturnType(form.type) && item.product_id && (
                            <div className="razdelka-stock-row-warning" style={{ marginTop: 4 }}>
                              по приходу:{' '}
                              {returnSourceProductMap[encodeProductPick(item.product_id, item.variant_id || null)] || 0}
                            </div>
                          )}
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.quantity}
                            disabled={isReadOnly}
                            onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                          />
                          {rowTransferWarning && (
                            <span className="razdelka-stock-row-warning">
                              ост: {rowTransferWarning.stock} {rowTransferWarning.unit}
                            </span>
                          )}
                        </td>
                        <td>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={formatPriceInput(item.price)}
                            disabled={isReadOnly}
                            onChange={(e) => updateItem(idx, 'price', parsePriceInput(e.target.value) ?? 0)}
                          />
                        </td>
                        <td>{formatMoney((Number(item.quantity) || 0) * (Number(item.price) || 0))}</td>
                        <td className="doc-items-actions-col">
                          {canEdit && (
                            <div className="doc-items-row-actions">
                              <IconButton
                                title="Добавить строку ниже"
                                onClick={() => addItemAfter(idx)}
                              >
                                <IconPlus />
                              </IconButton>
                              <IconButton
                                title="Удалить строку"
                                danger
                                onClick={() => removeItem(idx)}
                                disabled={form.items.length <= 1}
                              >
                                <IconTrash />
                              </IconButton>
                            </div>
                          )}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="doc-modal-footer">
              <div className="doc-modal-footer-comment">
                <label>Комментарий</label>
                <textarea
                  rows={1}
                  value={form.comment}
                  onChange={(e) => setForm({ ...form, comment: e.target.value })}
                  disabled={isReadOnly}
                  placeholder="Примечание к документу..."
                />
              </div>
              <div className="doc-modal-total">Итого: {formatMoney(total)}</div>
            </div>
          </div>
        </Modal>
      )}

      {paymentModal && (
        <Modal
          title={`Оплата по документу №${paymentModal.number}`}
          onClose={() => setPaymentModal(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setPaymentModal(null)}>Отмена</button>
              <button className="btn btn-primary" onClick={savePayment}>Сохранить оплату</button>
            </>
          }
        >
          <div className="form-grid">
            <div className="form-group">
              <label>Контрагент</label>
              <input value={paymentModal.counterparty_name || '—'} disabled />
            </div>
            <div className="form-group">
              <label>Сумма документа</label>
              <input value={formatMoney(paymentModal.total_amount)} disabled />
            </div>
            <div className="form-group">
              <label>Уже оплачено</label>
              <input value={formatMoney(getDocPaid(paymentModal.id))} disabled />
            </div>
            <div className="form-group">
              <label>Дата оплаты</label>
              <input
                type="date"
                value={paymentForm.date}
                onChange={(e) => setPaymentForm({ ...paymentForm, date: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Сумма оплаты *</label>
              <input
                type="number"
                min="0"
                value={paymentForm.amount}
                onChange={(e) => setPaymentForm({ ...paymentForm, amount: +e.target.value })}
              />
            </div>
            <div className="form-group full">
              <label>Комментарий</label>
              <textarea
                rows={2}
                value={paymentForm.comment}
                onChange={(e) => setPaymentForm({ ...paymentForm, comment: e.target.value })}
              />
            </div>
          </div>
        </Modal>
      )}

      {historyModal && (
        <Modal title="История изменений" closeOnBackdrop onClose={() => setHistoryModal(null)}>
          {history.length === 0 && <div className="empty">История пуста</div>}
          {history.map((h) => (
            <div key={h.id} className="history-item">
              <div className="meta">{formatDate(h.created_at)} · {h.user_name || h.changed_by_name || 'Не указан'}</div>
              <div className="action">{ACTION_LABELS[h.action] || h.action}</div>
              {h.snapshot?.document && (
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {h.snapshot.document.number} · {formatMoney(h.snapshot.document.total_amount)} ·
                  {' '}{h.snapshot.items?.length || 0} поз.
                </div>
              )}
            </div>
          ))}
        </Modal>
      )}

      {actionsMenuDoc && actionsMenuPos && createPortal(
        <div
          className="doc-actions-menu"
          style={{
            position: 'fixed',
            top: actionsMenuPos.top,
            left: actionsMenuPos.left,
            transform: 'translateX(-100%)',
            zIndex: 1100,
          }}
        >
          {renderExtraActions(actionsMenuDoc)}
        </div>,
        document.body,
      )}
    </div>
  );
}
