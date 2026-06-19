const STORAGE_KEY = 'public_shop_cart';

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeAll(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function itemKey(productId, variantId) {
  return `${productId}:${variantId || ''}`;
}

export function getCartItems(branchId) {
  if (!branchId) return [];
  return readAll()[branchId]?.items || [];
}

export function saveCartItems(branchId, items) {
  const all = readAll();
  if (!items.length) {
    delete all[branchId];
  } else {
    all[branchId] = { items, updatedAt: Date.now() };
  }
  writeAll(all);
}

export function addCartItem(branchId, item) {
  const items = [...getCartItems(branchId)];
  const key = itemKey(item.product_id, item.variant_id);
  const index = items.findIndex((row) => itemKey(row.product_id, row.variant_id) === key);

  if (index >= 0) {
    items[index] = {
      ...items[index],
      quantity: items[index].quantity + item.quantity,
    };
  } else {
    items.push(item);
  }

  saveCartItems(branchId, items);
  return items;
}

export function updateCartItemQty(branchId, productId, variantId, quantity) {
  const items = getCartItems(branchId).map((row) => {
    if (row.product_id !== productId) return row;
    if ((row.variant_id || null) !== (variantId || null)) return row;
    return { ...row, quantity };
  }).filter((row) => row.quantity > 0);

  saveCartItems(branchId, items);
  return items;
}

export function removeCartItem(branchId, productId, variantId) {
  const key = itemKey(productId, variantId);
  const items = getCartItems(branchId).filter(
    (row) => itemKey(row.product_id, row.variant_id) !== key,
  );
  saveCartItems(branchId, items);
  return items;
}

export function clearCart(branchId) {
  saveCartItems(branchId, []);
  return [];
}

export function cartCount(items) {
  return items.reduce((sum, row) => sum + (row.quantity || 0), 0);
}

export function cartTotal(items) {
  return items.reduce((sum, row) => sum + (row.price || 0) * (row.quantity || 0), 0);
}
