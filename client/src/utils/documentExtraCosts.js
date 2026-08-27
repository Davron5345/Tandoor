function roundMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

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

export function allocateExtraCosts(items, extras) {
  const rows = items || [];
  const extrasByIndex = rows.map(() => 0);
  const capTotal = roundMoney(capitalizedExtraTotal(extras));
  if (!(capTotal > 0) || rows.length === 0) return extrasByIndex;

  const qtys = rows.map(stockQtyOf);
  const totalQty = qtys.reduce((s, q) => s + q, 0);
  if (!(totalQty > 0)) return extrasByIndex;

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
