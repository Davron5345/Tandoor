import { useRef, useState } from 'react';
import { formatMoney } from '../../api';

const DELETE_WIDTH = 76;

function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9z"
        fill="currentColor"
      />
    </svg>
  );
}

export default function CartSwipeItem({ item, onRemove, onQtyChange }) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startXRef = useRef(0);
  const startOffsetRef = useRef(0);
  const pointerIdRef = useRef(null);

  const label = item.variant_name
    ? `${item.product_name} — ${item.variant_name}`
    : item.product_name;

  const clampOffset = (value) => Math.min(0, Math.max(-DELETE_WIDTH, value));

  const finishDrag = (nextOffset) => {
    setDragging(false);
    pointerIdRef.current = null;
    setOffset(nextOffset <= -DELETE_WIDTH / 2 ? -DELETE_WIDTH : 0);
  };

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointerIdRef.current = e.pointerId;
    startXRef.current = e.clientX;
    startOffsetRef.current = offset;
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (pointerIdRef.current !== e.pointerId) return;
    const dx = e.clientX - startXRef.current;
    setOffset(clampOffset(startOffsetRef.current + dx));
  };

  const onPointerUp = (e) => {
    if (pointerIdRef.current !== e.pointerId) return;
    const dx = e.clientX - startXRef.current;
    finishDrag(clampOffset(startOffsetRef.current + dx));
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const onPointerCancel = (e) => {
    if (pointerIdRef.current !== e.pointerId) return;
    finishDrag(0);
  };

  const handleDelete = () => {
    onRemove(item.product_id, item.variant_id);
  };

  return (
    <li className="public-shop-cart-swipe">
      <div className="public-shop-cart-swipe-delete" aria-hidden>
        <button type="button" onClick={handleDelete} aria-label="Удалить">
          <IconTrash />
        </button>
      </div>
      <div
        className={`public-shop-cart-swipe-content${dragging ? ' is-dragging' : ''}`}
        style={{ transform: `translate3d(${offset}px, 0, 0)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <div className="public-shop-cart-item">
          <div className="public-shop-cart-item-main">
            <strong>{label}</strong>
            <span>{formatMoney(item.price)} × {item.quantity} {item.unit || 'шт'}</span>
            <strong>{formatMoney(item.price * item.quantity)}</strong>
          </div>
          <div className="public-shop-cart-item-actions">
            <div className="myshop-qty-controls myshop-qty-controls-sm">
              <button
                type="button"
                onClick={() => onQtyChange(item.product_id, item.variant_id, item.quantity - 1)}
                aria-label="Меньше"
              >
                −
              </button>
              <span>{item.quantity}</span>
              <button
                type="button"
                onClick={() => onQtyChange(item.product_id, item.variant_id, item.quantity + 1)}
                aria-label="Больше"
              >
                +
              </button>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}
