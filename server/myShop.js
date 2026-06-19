import { v4 as uuidv4 } from 'uuid';
import { getSetting, setSetting } from './services/telegram.js';

const BLOCK_TYPES = new Set([
  'grid_3_2',
  'grid_2_3',
  'grid_3_3',
  'grid_1_2',
  'grid_2_1',
  'checkerboard',
  'grid_3',
  'grid_2',
  'grid_3n',
  'grid_2n',
  'slider',
]);

export const DEFAULT_MYSHOP_LAYOUT = {
  settings: {
    showcase: true,
    menu: true,
    hideBackground: false,
    transparentBackground: false,
    photoOutside: false,
  },
  blocks: [],
};

function layoutKey(branchId) {
  return `myshop_layout:${branchId || 'main'}`;
}

function normalizeSettings(raw = {}) {
  return {
    showcase: raw.showcase !== false,
    menu: raw.menu !== false,
    hideBackground: !!raw.hideBackground,
    transparentBackground: !!raw.transparentBackground,
    photoOutside: !!raw.photoOutside,
  };
}

function normalizeBlock(block, index) {
  if (!block || typeof block !== 'object') {
    throw new Error(`Блок #${index + 1}: некорректные данные`);
  }
  const type = String(block.type || '');
  if (!BLOCK_TYPES.has(type)) {
    throw new Error(`Блок #${index + 1}: неизвестный тип`);
  }
  const categoryIds = Array.isArray(block.categoryIds)
    ? [...new Set(block.categoryIds.map((id) => String(id)).filter(Boolean))]
    : [];

  return {
    id: String(block.id || uuidv4()),
    type,
    title: String(block.title || '').slice(0, 120),
    categoryIds,
  };
}

export function normalizeMyShopLayout(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_MYSHOP_LAYOUT, blocks: [] };
  const blocks = Array.isArray(raw.blocks) ? raw.blocks.map(normalizeBlock) : [];
  return {
    settings: normalizeSettings(raw.settings),
    blocks,
  };
}

export function getMyShopLayout(branchId) {
  const stored = getSetting(layoutKey(branchId));
  if (!stored) return { ...DEFAULT_MYSHOP_LAYOUT, blocks: [] };
  try {
    return normalizeMyShopLayout(JSON.parse(stored));
  } catch {
    return { ...DEFAULT_MYSHOP_LAYOUT, blocks: [] };
  }
}

export function saveMyShopLayout(branchId, payload) {
  const layout = normalizeMyShopLayout(payload);
  setSetting(layoutKey(branchId), JSON.stringify(layout));
  return layout;
}
