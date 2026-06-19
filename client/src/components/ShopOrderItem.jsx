import { formatMoney } from '../api';
import { IconImage } from './ActionIcons';

export default function ShopOrderItem({ item }) {
  const label = item.variant_name
    ? `${item.product_name} — ${item.variant_name}`
    : item.product_name;

  return (
    <li className="shop-order-item">
      <div className="shop-order-item-photo">
        {item.image_url ? (
          <img src={item.image_url} alt="" loading="lazy" />
        ) : (
          <div className="shop-order-item-photo-empty" aria-hidden>
            <IconImage />
          </div>
        )}
      </div>
      <div className="shop-order-item-main">
        <span className="shop-order-item-name">{label}</span>
        <span className="shop-order-item-meta">
          {item.quantity} {item.unit || 'шт'} × {formatMoney(item.price)}
        </span>
      </div>
      <strong className="shop-order-item-total">{formatMoney(item.line_total)}</strong>
    </li>
  );
}
