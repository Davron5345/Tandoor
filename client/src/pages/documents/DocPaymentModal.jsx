import { formatMoney } from '../../api';
import Modal from '../../components/Modal';

export default function DocPaymentModal({ doc, paid, form, setForm, onSave, onClose }) {
  return (
    <Modal
      title={`Оплата по документу №${doc.number}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn btn-primary" onClick={onSave}>Сохранить оплату</button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-group">
          <label>Контрагент</label>
          <input value={doc.counterparty_name || '—'} disabled />
        </div>
        <div className="form-group">
          <label>Сумма документа</label>
          <input value={formatMoney(doc.total_amount)} disabled />
        </div>
        <div className="form-group">
          <label>Уже оплачено</label>
          <input value={formatMoney(paid)} disabled />
        </div>
        <div className="form-group">
          <label>Дата оплаты</label>
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label>Сумма оплаты *</label>
          <input
            type="number"
            min="0"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: +e.target.value })}
          />
        </div>
        <div className="form-group full">
          <label>Комментарий</label>
          <textarea
            rows={2}
            value={form.comment}
            onChange={(e) => setForm({ ...form, comment: e.target.value })}
          />
        </div>
      </div>
    </Modal>
  );
}
