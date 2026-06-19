export const DEFAULT_MYSHOP_SETTINGS = {
  showcase: true,
  menu: true,
  hideBackground: false,
  transparentBackground: false,
  photoOutside: false,
};

export const BLOCK_TEMPLATES = {
  grid_3_2: {
    label: '3 сверху + 2 снизу',
    shortLabel: 'Сетка 3+2',
    group: 'template',
    hint: 'Один блок, 5 категорий',
    max: 5,
    layout: 'grid-3-2',
  },
  grid_2_3: {
    label: '2 сверху + 3 снизу',
    shortLabel: 'Сетка 2+3',
    group: 'template',
    hint: 'Один блок, 5 категорий',
    max: 5,
    layout: 'grid-2-3',
  },
  grid_3_3: {
    label: '3 сверху + 3 снизу + 3',
    shortLabel: 'Сетка 3×3',
    group: 'template',
    hint: 'Один блок, 9 категорий',
    max: 9,
    layout: 'grid-3-3',
  },
  grid_1_2: {
    label: '1 сверху + 2 снизу',
    shortLabel: 'Сетка 1+2',
    group: 'template',
    hint: 'Один блок, 3 категории',
    max: 3,
    layout: 'grid-1-2',
  },
  grid_2_1: {
    label: '2 сверху + 1 снизу',
    shortLabel: 'Сетка 2+1',
    group: 'template',
    hint: 'Один блок, 3 категории',
    max: 3,
    layout: 'grid-2-1',
  },
  checkerboard: {
    label: 'Широкий + квадратный',
    shortLabel: 'Шахматный',
    group: 'template',
    hint: 'Шахматный 2-колоночный блок',
    max: 8,
    layout: 'checkerboard',
  },
  grid_3: {
    label: 'Сетка 3× (3 колонны)',
    shortLabel: 'Сетка 3×',
    group: 'single',
    hint: 'Маленькие иконки',
    max: 3,
    layout: 'grid-3',
  },
  grid_2: {
    label: 'Сетка 2× (2 колонны)',
    shortLabel: 'Сетка 2×',
    group: 'single',
    hint: 'Средние карточки',
    max: 2,
    layout: 'grid-2',
  },
  grid_3n: {
    label: 'Сетка 3×N (без лимита)',
    shortLabel: 'Сетка 3×N',
    group: 'single',
    hint: 'Любое количество категорий',
    max: null,
    layout: 'grid-3n',
  },
  grid_2n: {
    label: 'Сетка 2×N (без лимита)',
    shortLabel: 'Сетка 2×N',
    group: 'single',
    hint: 'Любое количество категорий',
    max: null,
    layout: 'grid-2n',
  },
  slider: {
    label: 'Слайдер',
    shortLabel: 'Слайдер',
    group: 'single',
    hint: 'Категория с товарами',
    max: null,
    layout: 'slider',
  },
};

export function createEmptyLayout() {
  return {
    settings: { ...DEFAULT_MYSHOP_SETTINGS },
    blocks: [],
  };
}

export function createBlock(type) {
  return {
    id: crypto.randomUUID(),
    type,
    title: '',
    categoryIds: [],
  };
}

export function getBlockMeta(type) {
  return BLOCK_TEMPLATES[type] || {
    label: type,
    shortLabel: type,
    group: 'single',
    hint: '',
    max: null,
    layout: 'grid-2n',
  };
}

export function getBlockLimit(type) {
  const meta = getBlockMeta(type);
  return meta.max;
}

export function canAddCategoryToBlock(block, categoryId) {
  if (!categoryId) return false;
  if (block.categoryIds.includes(categoryId)) return false;
  const limit = getBlockLimit(block.type);
  if (limit != null && block.categoryIds.length >= limit) return false;
  return true;
}

export function buildCategoryImageMap(products = []) {
  const map = new Map();
  for (const product of products) {
    if (product.category_id && product.primary_image && !map.has(product.category_id)) {
      map.set(product.category_id, product.primary_image.url);
    }
  }
  return map;
}

export function buildCategoryProductMap(products = []) {
  const map = new Map();
  for (const product of products) {
    if (!product.category_id) continue;
    if (!map.has(product.category_id)) map.set(product.category_id, []);
    map.get(product.category_id).push(product);
  }
  return map;
}
