function roundMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** Складское кол-во строки: нетто × шт, если нетто > 0, иначе quantity. */
export function stockQtyOf(item) {
  const qty = Math.abs(Number(item.quantity) || 0);
  const net = Number(item.net_weight) || 0;
  return net > 0 ? net * qty : qty;
}

export function isCapitalizeFlag(value) {
  return !(value === false || value === 0 || value === '0');
}

export function extraCostsTotal(extras) {
  return (extras || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
}

export function capitalizedExtraTotal(extras) {
  return (extras || []).reduce((s, e) => (
    isCapitalizeFlag(e.capitalize) ? s + (Number(e.amount) || 0) : s
  ), 0);
}

export function normalizeExtraCosts(raw, docType) {
  const list = Array.isArray(raw) ? raw : [];
  if (docType && docType !== 'prihod' && list.length > 0) {
    throw new Error('Доп. расходы можно указать только в приходе');
  }
  if (docType && docType !== 'prihod') return [];

  const out = [];
  list.forEach((row, idx) => {
    const title = String(row?.title || '').trim();
    const rawAmount = row?.amount;
    const hasRaw = rawAmount !== undefined && rawAmount !== null && String(rawAmount).trim() !== '';
    const amount = hasRaw ? Number(rawAmount) : 0;
    if (!title && (!hasRaw || amount === 0)) return;
    if (!title) throw new Error('Укажите название доп. расхода');
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('Сумма доп. расхода не может быть отрицательной');
    }
    out.push({
      title,
      amount: roundMoney(amount),
      capitalize: isCapitalizeFlag(row.capitalize) ? 1 : 0,
      sort_order: idx,
    });
  });
  return out;
}

/**
 * Раскидывает капитализированные доп. расходы пропорционально stockQty.
 * Остаток копеек — на последнюю строку с ненулевым количеством на склад.
 */
export function allocateExtraCosts(items, extras) {
  const rows = items || [];
  const extrasByIndex = rows.map(() => 0);
  const capTotal = roundMoney(capitalizedExtraTotal(extras));
  if (!(capTotal > 0) || rows.length === 0) return extrasByIndex;

  const qtys = rows.map(stockQtyOf);
  const totalQty = qtys.reduce((s, q) => s + q, 0);
  if (!(totalQty > 0)) {
    throw new Error('Нельзя отнести доп. расходы в себестоимость: укажите количество или нетто');
  }

  let lastIdx = -1;
  qtys.forEach((q, i) => {
    if (q > 0) lastIdx = i;
  });

  let allocated = 0;
  rows.forEach((_, i) => {
    if (!(qtys[i] > 0)) return;
    if (i === lastIdx) {
      extrasByIndex[i] = roundMoney(capTotal - allocated);
      return;
    }
    const share = roundMoney(capTotal * (qtys[i] / totalQty));
    extrasByIndex[i] = share;
    allocated += share;
  });
  return extrasByIndex;
}
