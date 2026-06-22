import { PRODUCT_KINDS, PRODUCT_KIND_LABELS_PLURAL, PRODUCT_KIND_LABELS_SHORT } from '../productKinds';

function formatCount(value) {
  if (value == null) return null;
  return value > 999 ? '999+' : String(value);
}

export default function ProductKindFilter({ value, onChange, counts = {} }) {
  const items = [
    { id: '', label: 'Все', shortLabel: 'Все' },
    ...PRODUCT_KINDS.map((kindId) => ({
      id: kindId,
      label: PRODUCT_KIND_LABELS_PLURAL[kindId],
      shortLabel: PRODUCT_KIND_LABELS_SHORT[kindId],
    })),
  ];

  return (
    <div className="kind-filter" role="tablist" aria-label="Вид номенклатуры">
      {items.map((item) => {
        const active = (value || '') === item.id;
        const count = item.id ? counts[item.id] : counts.all;
        const countLabel = formatCount(count);

        return (
          <button
            key={item.id || 'all'}
            type="button"
            role="tab"
            aria-selected={active}
            className={`kind-filter-chip${active ? ' active' : ''}`}
            onClick={() => onChange(item.id)}
          >
            <span className="kind-filter-chip-label kind-filter-chip-label--full">{item.label}</span>
            <span className="kind-filter-chip-label kind-filter-chip-label--short">{item.shortLabel}</span>
            {countLabel != null && (
              <span className="kind-filter-chip-count">{countLabel}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
