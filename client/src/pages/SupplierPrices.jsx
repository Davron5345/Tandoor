import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api, formatDate, formatMoney, formatPriceInput, parsePriceInput, STATUS_LABELS,
} from '../api';
import Modal, { useToast, ModalCancelButton } from '../components/Modal';
import { IconButton, IconEdit, IconEye, IconTrash } from '../components/ActionIcons';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';
import ProductSelect from '../components/ProductSelect';
import CounterpartySearchSelect from '../components/CounterpartySearchSelect';
import { encodeProductPick, resolvePickFromProducts } from '../utils/productVariants';
import { hasPermission } from '../permissions';
import { todayLocalIso } from '../utils/date';

const emptyLine = () => ({ product_id: '', variant_id: null, price: '' });

const emptyForm = () => ({
  date: todayLocalIso(),
  counterparty_id: '',
  comment: '',
  items: [emptyLine()],
});

export default function SupplierPrices() {
  const { user } = useAuth();
  const { branchId } = useBranch();
  const { show } = useToast();
  const canEdit = hasPermission(user, 'products.edit');

  const [docs, setDocs] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [readOnly, setReadOnly] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, cps, prods] = await Promise.all([
        api.getSupplierPrices(),
        api.getCounterparties('supplier'),
        api.getProducts({ limit: 5000 }),
      ]);
      setDocs(Array.isArray(list) ? list : []);
      setSuppliers(Array.isArray(cps) ? cps : []);
      setProducts(Array.isArray(prods) ? prods : (prods?.items || []));
    } catch (e) {
      show(e.message || 'Ошибка загрузки', 'error');
    } finally {
      setLoading(false);
    }
  }, [show, branchId]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setForm(emptyForm());
    setReadOnly(false);
    setModal('create');
  };

  const openDoc = async (id, viewOnly = false) => {
    try {
      const doc = await api.getSupplierPrice(id);
      setForm({
        id: doc.id,
        date: doc.date,
        counterparty_id: doc.counterparty_id || '',
        comment: doc.comment || '',
        status: doc.status,
        number: doc.number,
        items: (doc.items || []).length
          ? doc.items.map((i) => ({
            product_id: i.product_id,
            variant_id: i.variant_id || null,
            price: i.price,
          }))
          : [emptyLine()],
      });
      setReadOnly(viewOnly || doc.status === 'confirmed');
      setModal(doc.id);
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const updateItemPick = (idx, pickValue) => {
    const resolved = resolvePickFromProducts(products, pickValue);
    const items = [...form.items];
    items[idx] = {
      ...items[idx],
      product_id: resolved.productId || '',
      variant_id: resolved.variantId || null,
    };
    setForm({ ...form, items });
  };

  const updateItemPrice = (idx, value) => {
    const items = [...form.items];
    items[idx] = { ...items[idx], price: value };
    setForm({ ...form, items });
  };

  const addItem = () => setForm({ ...form, items: [...form.items, emptyLine()] });
  const removeItem = (idx) => {
    if (form.items.length <= 1) return;
    setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });
  };

  const save = async ({ andConfirm = false } = {}) => {
    if (!form.counterparty_id) {
      show('Выберите поставщика', 'error');
      return;
    }
    const items = form.items
      .filter((i) => i.product_id)
      .map((i) => ({
        product_id: i.product_id,
        variant_id: i.variant_id || null,
        price: parsePriceInput(i.price) ?? 0,
      }));
    if (!items.length) {
      show('Добавьте товары с ценами', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        date: form.date,
        counterparty_id: form.counterparty_id,
        comment: form.comment,
        items,
      };
      let doc;
      if (form.id) {
        doc = await api.updateSupplierPrice(form.id, payload);
      } else {
        doc = await api.createSupplierPrice(payload);
      }
      if (andConfirm) {
        doc = await api.confirmSupplierPrice(doc.id);
      }
      show(andConfirm ? 'Прайс проведён' : 'Сохранено');
      setModal(null);
      await load();
    } catch (e) {
      show(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const confirmDoc = async (id) => {
    try {
      await api.confirmSupplierPrice(id);
      show('Прайс проведён');
      setModal(null);
      await load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const cancelDoc = async (id) => {
    if (!window.confirm('Отменить проведение? Прайс снова станет черновиком.')) return;
    try {
      await api.cancelSupplierPrice(id);
      show('Проведение отменено');
      setModal(null);
      await load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const removeDoc = async (id) => {
    if (!window.confirm('Удалить прайс?')) return;
    try {
      await api.deleteSupplierPrice(id);
      show('Удалено');
      await load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const total = useMemo(
    () => form.items.reduce((s, i) => s + ((parsePriceInput(i.price) ?? Number(i.price)) || 0), 0),
    [form.items],
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Прайсы поставщиков</h1>
          <p className="muted">Документы цен: дата, поставщик, товары. В приходе подставляется цена из последнего прайса.</p>
        </div>
        {canEdit && (
          <button type="button" className="btn btn-primary" onClick={openCreate}>+ Новый прайс</button>
        )}
      </div>

      <div className="card">
        {loading ? (
          <p className="muted">Загрузка…</p>
        ) : docs.length === 0 ? (
          <p className="muted">Пока нет прайс-документов. Создайте прайс или проведите приход — цены запишутся автоматически.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>№</th>
                  <th>Поставщик</th>
                  <th>Позиций</th>
                  <th>Статус</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td>{formatDate(d.date)}</td>
                    <td>{d.number}</td>
                    <td>{d.counterparty_name || '—'}</td>
                    <td>{d.lines_count || 0}</td>
                    <td>
                      <span className={`badge badge-${d.status}`}>
                        {STATUS_LABELS[d.status] || d.status}
                      </span>
                    </td>
                    <td>
                      <div className="icon-toolbar">
                        <IconButton title="Открыть" onClick={() => openDoc(d.id, d.status === 'confirmed')}>
                          {d.status === 'confirmed' ? <IconEye /> : <IconEdit />}
                        </IconButton>
                        {canEdit && d.status !== 'confirmed' && (
                          <IconButton title="Удалить" danger onClick={() => removeDoc(d.id)}>
                            <IconTrash />
                          </IconButton>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <Modal
          title={form.id ? `Прайс №${form.number || ''}` : 'Новый прайс поставщика'}
          wide
          onClose={() => setModal(null)}
          footer={(
            <>
              <ModalCancelButton />
              {canEdit && form.status === 'confirmed' && (
                <button type="button" className="btn btn-ghost" onClick={() => cancelDoc(form.id)}>
                  Отменить проведение
                </button>
              )}
              {canEdit && !readOnly && (
                <>
                  <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => save()}>
                    Сохранить
                  </button>
                  <button type="button" className="btn btn-primary" disabled={saving} onClick={() => save({ andConfirm: true })}>
                    Сохранить и провести
                  </button>
                </>
              )}
              {canEdit && form.id && form.status === 'draft' && readOnly === false && modal !== 'create' && (
                <button type="button" className="btn btn-primary" onClick={() => confirmDoc(form.id)}>
                  Провести
                </button>
              )}
            </>
          )}
        >
          <div className="form-grid" style={{ marginBottom: 12 }}>
            <label>
              Дата
              <input
                type="date"
                value={form.date}
                disabled={readOnly}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </label>
            <label>
              Поставщик
              {readOnly ? (
                <input
                  value={suppliers.find((s) => s.id === form.counterparty_id)?.name || '—'}
                  disabled
                />
              ) : (
                <CounterpartySearchSelect
                  items={suppliers}
                  value={form.counterparty_id}
                  onChange={(id) => setForm({ ...form, counterparty_id: id || '' })}
                  placeholder="Найти поставщика…"
                />
              )}
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Комментарий
              <input
                value={form.comment}
                disabled={readOnly}
                onChange={(e) => setForm({ ...form, comment: e.target.value })}
              />
            </label>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Товар</th>
                  <th style={{ width: 140 }}>Цена</th>
                  {!readOnly && <th style={{ width: 70 }} />}
                </tr>
              </thead>
              <tbody>
                {form.items.map((item, idx) => (
                  <tr key={idx}>
                    <td>
                      {readOnly ? (
                        (() => {
                          const resolved = resolvePickFromProducts(
                            products,
                            encodeProductPick(item.product_id, item.variant_id),
                          );
                          if (resolved.variant) {
                            return `${resolved.product?.name || ''} — ${resolved.variant.name}`;
                          }
                          return resolved.product?.name || '—';
                        })()
                      ) : (
                        <ProductSelect
                          products={products}
                          value={encodeProductPick(item.product_id, item.variant_id)}
                          onChange={(v) => updateItemPick(idx, v)}
                        />
                      )}
                    </td>
                    <td>
                      <input
                        className="input-money"
                        value={formatPriceInput(item.price)}
                        disabled={readOnly}
                        onChange={(e) => updateItemPrice(idx, parsePriceInput(e.target.value) ?? 0)}
                      />
                    </td>
                    {!readOnly && (
                      <td>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeItem(idx)}>×</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!readOnly && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={addItem}>
              + Строка
            </button>
          )}
          <p className="muted" style={{ marginTop: 12 }}>
            Сумма прайса (справочно): {formatMoney(total)}
          </p>
        </Modal>
      )}
    </div>
  );
}
