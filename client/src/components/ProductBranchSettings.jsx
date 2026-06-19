import { formatPriceInput, parsePriceInput, formatMoney } from '../api';

function formatBranchPrice(value) {
  if (value == null || value === '') return '';
  return formatPriceInput(value);
}

function parseBranchPrice(value) {
  if (value === '' || value == null) return null;
  return parsePriceInput(value);
}

export default function ProductBranchSettings({
  settings,
  setSettings,
  hasVariants,
  basePrice,
}) {
  const updateBranch = (branchId, patch) => {
    setSettings((prev) => prev.map((row) => (
      row.branch_id === branchId ? { ...row, ...patch } : row
    )));
  };

  const updateVariantPrice = (branchId, variantId, priceText) => {
    setSettings((prev) => prev.map((row) => {
      if (row.branch_id !== branchId) return row;
      return {
        ...row,
        variants: row.variants.map((v) => (
          v.variant_id === variantId ? { ...v, price: priceText } : v
        )),
      };
    }));
  };

  if (!settings.length) {
    return <p className="empty">Нет филиалов</p>;
  }

  return (
    <div className="product-branch-settings">
      <p className="product-variants-main-note" style={{ marginBottom: 16 }}>
        Базовая цена{hasVariants ? ' (мин. по вариантам)' : ''}: {basePrice != null && basePrice !== '—' ? formatMoney(basePrice) : '—'}.
        Пустое поле цены филиала — используется базовая.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Филиал</th>
              <th>Показывать</th>
              {!hasVariants && <th>Цена филиала</th>}
              {hasVariants && <th>Цены вариантов</th>}
            </tr>
          </thead>
          <tbody>
            {settings.map((row) => (
              <tr key={row.branch_id} className={!row.branch_active ? 'text-muted' : ''}>
                <td>
                  {row.branch_name}
                  {!row.branch_active && <span style={{ marginLeft: 8, fontSize: 12 }}>(отключён)</span>}
                </td>
                <td>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={!!row.visible}
                      onChange={(e) => updateBranch(row.branch_id, { visible: e.target.checked })}
                    />
                    <span>{row.visible ? 'Да' : 'Нет'}</span>
                  </label>
                </td>
                {!hasVariants && (
                  <td>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="Как базовая"
                      value={formatBranchPrice(row.price)}
                      onChange={(e) => updateBranch(row.branch_id, {
                        price: formatPriceInput(e.target.value),
                      })}
                      style={{ maxWidth: 160 }}
                    />
                  </td>
                )}
                {hasVariants && (
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {row.variants.map((variant) => (
                        <label key={variant.variant_id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ minWidth: 120 }}>{variant.name}</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            placeholder={variant.base_price != null ? String(variant.base_price) : 'базовая'}
                            value={typeof variant.price === 'string'
                              ? variant.price
                              : formatBranchPrice(variant.price)}
                            onChange={(e) => updateVariantPrice(
                              row.branch_id,
                              variant.variant_id,
                              formatPriceInput(e.target.value),
                            )}
                            style={{ maxWidth: 140 }}
                          />
                        </label>
                      ))}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function mapBranchSettingsFromApi(rows = []) {
  return rows.map((row) => ({
    ...row,
    price: row.price != null ? formatPriceInput(row.price) : '',
    variants: (row.variants || []).map((v) => ({
      ...v,
      price: v.price != null ? formatPriceInput(v.price) : '',
    })),
  }));
}

export function serializeBranchSettingsForApi(rows = []) {
  return rows.map((row) => ({
    branch_id: row.branch_id,
    visible: !!row.visible,
    price: parseBranchPrice(row.price),
    variants: (row.variants || []).map((v) => ({
      variant_id: v.variant_id,
      price: parseBranchPrice(v.price),
    })),
  }));
}
