import { formatMoney } from '../api';

export { pickPriceTrend, priceTrendFromValues, prihodLinePriceTrend } from '../utils/priceTrend';

export function PriceTrendMark({ trend }) {
  if (!trend?.dir) return null;
  const up = trend.dir === 'up';
  const title = up
    ? `Подорожало: было ${formatMoney(trend.prev)}, стало ${formatMoney(trend.last)}`
    : `Подешевело: было ${formatMoney(trend.prev)}, стало ${formatMoney(trend.last)}`;
  return (
    <span
      className={`price-trend ${up ? 'is-up' : 'is-down'}`}
      title={title}
      aria-label={title}
    >
      {up ? '▲' : '▼'}
    </span>
  );
}

export function PriceWithTrend({ children, trend }) {
  return (
    <span className="price-with-trend">
      {children}
      <PriceTrendMark trend={trend} />
    </span>
  );
}
