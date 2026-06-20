import { todayLocalIso } from './utils/date';

export const ROLES = {
  admin: { label: 'Администратор', description: 'Полный доступ ко всем разделам' },
  warehouse: { label: 'Завсклад', description: 'Приход, расход, перемещение товаров' },
  cashier: { label: 'Кассир', description: 'Касса: приход и расход за смену' },
  accountant: { label: 'Бухгалтер', description: 'Касса, оплаты и отчёты' },
};

export function canModifyPaymentDate(user, paymentDate) {
  if (hasAnyPermission(user, ['payments.edit_past', 'cashier.edit_past'])) return true;
  return paymentDate === todayLocalIso();
}

export function hasPermission(user, permission) {
  if (!user?.permissions) return false;
  if (user.permissions.includes('*')) return true;
  return user.permissions.includes(permission);
}

export function hasAnyPermission(user, permissions) {
  return permissions.some((p) => hasPermission(user, p));
}

export const PAYMENT_TYPES = {
  supplier_payment: 'Оплата поставщику',
  customer_income: 'Оплата от клиента',
  other_income: 'Прочий приход',
  other_expense: 'Прочий расход',
};

export const DOC_TYPE_LABELS = {
  prihod: 'Приход',
  rashod: 'Расход',
  return_supplier: 'Возврат поставщику',
  peremeshchenie: 'Перемещение',
  razdelka: 'Разделка',
  opening_balance: 'Начальное сальдо',
};
