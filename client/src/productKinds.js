export const PRODUCT_KIND_GOODS = 'goods';
export const PRODUCT_KIND_RAW = 'raw';
export const PRODUCT_KIND_SEMI = 'semi_finished';
export const PRODUCT_KIND_DISH = 'dish';

export const PRODUCT_KINDS = [
  PRODUCT_KIND_GOODS,
  PRODUCT_KIND_RAW,
  PRODUCT_KIND_SEMI,
  PRODUCT_KIND_DISH,
];

export const PRODUCT_KIND_LABELS = {
  [PRODUCT_KIND_GOODS]: 'Товар',
  [PRODUCT_KIND_RAW]: 'Сырьё',
  [PRODUCT_KIND_SEMI]: 'Полуфабрикат',
  [PRODUCT_KIND_DISH]: 'Готовое блюдо',
};

export const PRODUCT_KIND_LABELS_PLURAL = {
  [PRODUCT_KIND_GOODS]: 'Товары',
  [PRODUCT_KIND_RAW]: 'Сырьё',
  [PRODUCT_KIND_SEMI]: 'Полуфабрикаты',
  [PRODUCT_KIND_DISH]: 'Готовые блюда',
};

export const PRODUCT_KIND_LABELS_SHORT = {
  [PRODUCT_KIND_GOODS]: 'Товары',
  [PRODUCT_KIND_RAW]: 'Сырьё',
  [PRODUCT_KIND_SEMI]: 'Полуфабр.',
  [PRODUCT_KIND_DISH]: 'Блюда',
};

export const INGREDIENT_KINDS = [PRODUCT_KIND_RAW, PRODUCT_KIND_SEMI];
export const DISH_OUTPUT_KINDS = [PRODUCT_KIND_DISH];
export const SEMI_OUTPUT_KINDS = [PRODUCT_KIND_SEMI];
export const RAZDELKA_OUTPUT_KINDS = [PRODUCT_KIND_SEMI, PRODUCT_KIND_GOODS];
export const MYSHOP_KINDS = [PRODUCT_KIND_RAW, PRODUCT_KIND_SEMI];

export const CALC_KIND_RAZDELKA = 'razdelka';
export const CALC_KIND_RECIPE = 'recipe';

export const CALCULATION_KIND_OPTIONS = [
  { value: CALC_KIND_RAZDELKA, label: 'Полуфабрикат' },
  { value: CALC_KIND_RECIPE, label: 'Готовая продукция' },
];

export function calculationKindLabel(kind) {
  return kind === CALC_KIND_RECIPE ? 'Готовая продукция' : 'Полуфабрикат';
}

export function productKindLabel(kind) {
  return PRODUCT_KIND_LABELS[kind] || PRODUCT_KIND_LABELS[PRODUCT_KIND_GOODS];
}

export function filterProductsByKinds(products, kinds) {
  if (!kinds?.length) return products;
  return products.filter((p) => kinds.includes(p.product_kind || PRODUCT_KIND_GOODS));
}
