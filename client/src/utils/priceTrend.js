import { lineMoneyFromItem, parsePriceInput, parseQuantityInput } from '../api';

export function priceTrendFromValues(current, previous) {
  const lastN = Number(current) || 0;
  const prevN = Number(previous) || 0;
  if (!(lastN > 0) || !(prevN > 0)) return null;
  if (lastN - prevN > 0.005) return { dir: 'up', last: lastN, prev: prevN };
  if (prevN - lastN > 0.005) return { dir: 'down', last: lastN, prev: prevN };
  return null;
}

export function pickPriceTrend(product, variant = null) {
  if (variant) return variant.price_trend || null;
  return product?.price_trend || null;
}

export function lineUnitCost(item) {
  const parsedQty = parseQuantityInput(item?.quantity);
  const qty = parsedQty ?? (Number(item?.quantity) || 0);
  const net = Number(item?.net_weight) || 0;
  const stockQty = net > 0 ? net * qty : qty;
  const { amount } = lineMoneyFromItem(item || {});
  if (stockQty > 0 && amount > 0) return amount / stockQty;
  return parsePriceInput(item?.price) ?? (Number(item?.price) || 0);
}

/** Текущая цена строки прихода vs последний confirmed приход; если совпадает — vs предыдущий. */
export function prihodLinePriceTrend(item, product, variant = null) {
  if (!item?.product_id) return null;
  const historical = pickPriceTrend(product, variant);
  const current = lineUnitCost(item);
  const last = Number(historical?.last) || Number(variant?.last_price ?? product?.last_price) || 0;
  const prev = Number(historical?.prev) || 0;
  if (!(current > 0)) return historical?.dir ? historical : null;
  if (last > 0 && Math.abs(current - last) > 0.005) {
    return priceTrendFromValues(current, last);
  }
  if (historical?.dir) return historical;
  return priceTrendFromValues(last, prev);
}
