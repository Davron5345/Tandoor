import { useEffect, useState } from 'react';
import { formatDate, parseQuantityInput, lineMoneyFromItem } from '../../api';
import { todayLocalIso } from '../../utils/date';

export const DEFAULT_CONTRACT_ID = '__default__';
export const RETURN_SUPPLIER_TYPE = 'return_supplier';
export const RETURN_CUSTOMER_TYPE = 'return_customer';
const DOCS_PHONE_MQ = '(max-width: 768px)';

export function useDocsPhone() {
  const [isPhone, setIsPhone] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia(DOCS_PHONE_MQ).matches
  ));
  useEffect(() => {
    const mq = window.matchMedia(DOCS_PHONE_MQ);
    const apply = () => setIsPhone(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  return isPhone;
}

export function hasRealSupplierContracts(contracts = []) {
  return contracts.some((c) => c.id !== DEFAULT_CONTRACT_ID && !c.virtual);
}

export function isSupplierReturnType(type) {
  return type === RETURN_SUPPLIER_TYPE;
}

export function isCustomerReturnType(type) {
  return type === RETURN_CUSTOMER_TYPE;
}

export function isAnyReturnType(type) {
  return isSupplierReturnType(type) || isCustomerReturnType(type);
}

export function isOutgoingDocType(type) {
  return type === 'rashod' || type === RETURN_SUPPLIER_TYPE;
}

export function formatContractLabel(contract) {
  if (!contract) return 'Основной договор';
  const title = (contract.title || '').trim();
  const number = contract.number || 'Основной договор';
  const head = title && title !== number ? `${title} · ${number}` : number;
  if (!contract.date) return head;
  return `${head} — ${formatDate(contract.date)}`;
}

export const emptyItem = { product_id: '', variant_id: null, quantity: 1, price: 0, net_weight: '' };
export const emptyExtraCost = { title: '', amount: '', capitalize: true };

export function hasNetColumn(type) {
  return type === 'prihod' || type === 'peremeshchenie';
}

export function lineStockQty(item) {
  const qty = parseQuantityInput(item.quantity) ?? 0;
  const net = Number(item.net_weight) || 0;
  if (!(qty > 0)) return 0;
  return net > 0 ? net * qty : qty;
}

function formatRemainQty(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(Math.round(v * 1000) / 1000);
}

export function lineAmountOf(item) {
  return lineMoneyFromItem(item).amount;
}

export function priceFromAmount(qty, amount) {
  if (!(qty > 0)) return 0;
  return amount / qty;
}

export function TransferStockHint({ value, unit, over }) {
  return (
    <span className={`doc-items-stock-hint${over ? ' is-over' : ''}`}>
      ост: {formatRemainQty(value)}{unit ? ` ${unit}` : ''}
    </span>
  );
}

export const emptyPayment = {
  type: 'supplier_payment',
  counterparty_id: '',
  document_id: '',
  amount: 0,
  date: todayLocalIso(),
  comment: '',
};

export const emptyDoc = {
  type: 'prihod',
  counterparty_id: '',
  source_document_id: '',
  contract_id: '',
  from_branch_id: '',
  to_branch_id: '',
  from_department_id: '',
  to_department_id: '',
  transfer_mode: 'department',
  date: todayLocalIso(),
  comment: '',
  status: 'draft',
  items: [{ ...emptyItem }],
  extra_costs: [],
  ai_recognized: false,
  ai_unconfirmed_count: 0,
  ai_pending_items: [],
  attachments: [],
  telegram_url: null,
};
