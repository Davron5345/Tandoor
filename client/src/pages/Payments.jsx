import { useCallback, useEffect, useState } from 'react';
import { api, formatMoney, formatDate } from '../api';
import { PAYMENT_TYPES } from '../permissions';
import Modal, { useToast } from '../components/Modal';
import { hasPermission } from '../permissions';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';

const empty = {
  type: 'supplier_payment',
  counterparty_id: '',
  document_id: '',
  amount: 0,
  date: new Date().toISOString().slice(0, 10),
  comment: '',
};

export default function Payments() {
  const [payments, setPayments] = useState([]);
  const [counterparties, setCounterparties] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(empty);
  const { show, Toast } = useToast();
  const { user } = useAuth();
  const { branchName, branchId } = useBranch();
  const canEdit = hasPermission(user, 'payments.edit');
  const canDelete = hasPermission(user, 'payments.delete');

  const load = useCallback(async () => {
    try {
      const p = await api.getPayments();
      setPayments(p);
      setCounterparties([]);
      setDocuments([]);
    } catch (err) {
      console.error(err);
      show(err.message || 'Не удалось загрузить оплаты', 'error');
      return;
    }

    try {
      const [c, d] = await Promise.all([api.getCounterparties(), api.getDocuments()]);
      setCounterparties(c);
      setDocuments(d.filter((x) => x.status === 'confirmed'));
    } catch (err) {
      console.error(err);
    }
  }, [show]);

  useEffect(() => { load(); }, [load, branchId]);

  const openCreate = () => { setForm({ ...empty }); setModal('create'); };
  const openEdit = (p) => {
    setForm({
      type: p.type,
      counterparty_id: p.counterparty_id || '',
      document_id: p.document_id || '',
      amount: p.amount,
      date: p.date,
      comment: p.comment || '',
    });
    setModal(p.id);
  };

  const save = async () => {
    try {
      if (modal === 'create') {
        await api.createPayment(form);
        show('Оплата добавлена');
      } else {
        await api.updatePayment(modal, form);
        show('Оплата обновлена');
      }
      setModal(null);
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const remove = async (p) => {
    if (!window.confirm(`Удалить оплату №${p.number}?`)) return;
    try {
      await api.deletePayment(p.id);
      show('Удалено');
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const filteredCp = counterparties.filter((c) => {
    if (form.type === 'supplier_payment' || form.type === 'other_expense') return c.type === 'supplier';
    if (form.type === 'customer_income') return c.type === 'client';
    return true;
  });

  return (
    <div>
      {Toast}
      <div className="page-header">
        <h1>Оплаты</h1>
        {canEdit && <button className="btn btn-primary" onClick={openCreate}>+ Новая оплата</button>}
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>№</th>
                <th>Тип</th>
                <th>Контрагент</th>
                <th>Документ</th>
                <th>Дата</th>
                <th>Сумма</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{p.number}</td>
                  <td>{PAYMENT_TYPES[p.type]}</td>
                  <td>{p.counterparty_name || '—'}</td>
                  <td>{p.document_number || '—'}</td>
                  <td>{formatDate(p.date)}</td>
                  <td>{formatMoney(p.amount)}</td>
                  <td>
                    {canEdit && (
                      <div className="btn-group">
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(p)}>Изменить</button>
                        {canDelete && (
                          <button className="btn btn-danger btn-sm" onClick={() => remove(p)}>Удалить</button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr><td colSpan={7} className="empty">Оплат пока нет</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <Modal
          title={modal === 'create' ? 'Новая оплата' : 'Редактировать оплату'}
          onClose={() => setModal(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setModal(null)}>Отмена</button>
              <button className="btn btn-primary" onClick={save}>Сохранить</button>
            </>
          }
        >
          <div className="form-grid">
            <div className="form-group">
              <label>Тип операции</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, counterparty_id: '' })}>
                {Object.entries(PAYMENT_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Дата</label>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Контрагент</label>
              <select value={form.counterparty_id} onChange={(e) => setForm({ ...form, counterparty_id: e.target.value })}>
                <option value="">— не выбран —</option>
                {filteredCp.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Связанный документ</label>
              <select value={form.document_id} onChange={(e) => setForm({ ...form, document_id: e.target.value })}>
                <option value="">— не выбран —</option>
                {documents.map((d) => (
                  <option key={d.id} value={d.id}>{d.number} — {formatMoney(d.total_amount)}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Сумма *</label>
              <input type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: +e.target.value })} />
            </div>
            <div className="form-group full">
              <label>Комментарий</label>
              <textarea rows={2} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
