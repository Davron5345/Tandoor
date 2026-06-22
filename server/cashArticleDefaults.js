export const PURCHASE_ARTICLE_CODE = 'exp_purchase';

export const LEGACY_ARTICLE_CODES = {
  ca_inc_sales: 'inc_sales',
  ca_inc_return: 'inc_return',
  ca_inc_other: 'inc_other',
  ca_exp_purchase: PURCHASE_ARTICLE_CODE,
  ca_exp_salary: 'exp_salary',
  ca_exp_rent: 'exp_rent',
  ca_exp_household: 'exp_household',
  ca_exp_other: 'exp_other',
};

export const SURPLUS_ARTICLE_CODE = 'inc_surplus';
export const SHORTAGE_ARTICLE_CODE = 'exp_shortage';

export const DEFAULT_CASH_ARTICLES = [
  { code: 'inc_sales', name: 'Выручка', direction: 'income', sort_order: 1 },
  { code: 'inc_return', name: 'Возврат', direction: 'income', sort_order: 2 },
  { code: 'inc_other', name: 'Прочий приход', direction: 'income', sort_order: 3 },
  { code: SURPLUS_ARTICLE_CODE, name: 'Излишек', direction: 'income', sort_order: 4 },
  { code: PURCHASE_ARTICLE_CODE, name: 'Закуп', direction: 'expense', sort_order: 1 },
  { code: 'exp_salary', name: 'Зарплата', direction: 'expense', sort_order: 2 },
  { code: 'exp_rent', name: 'Аренда', direction: 'expense', sort_order: 3 },
  { code: 'exp_household', name: 'Хозрасходы', direction: 'expense', sort_order: 4 },
  { code: 'exp_other', name: 'Прочий расход', direction: 'expense', sort_order: 5 },
  { code: SHORTAGE_ARTICLE_CODE, name: 'Недостача', direction: 'expense', sort_order: 6 },
];

export function cashArticleId(branchId, code) {
  return `${branchId || 'main'}__${code}`;
}
