import { formatPriceInput, parsePriceInput } from '../api';
import { formatUzPhone } from '../phoneFormat';

export default function CounterpartyFormFields({ form, setForm, lockType = null }) {
  const typeLocked = lockType === 'supplier' || lockType === 'client';

  return (
    <div className="form-grid">
      <div className="form-group">
        <label>Название *</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="form-group">
        <label>Тип *</label>
        <select
          value={typeLocked ? lockType : form.type}
          disabled={typeLocked}
          onChange={(e) => setForm({ ...form, type: e.target.value })}
        >
          <option value="supplier">Поставщик</option>
          <option value="client">Клиент</option>
        </select>
      </div>
      <div className="form-group">
        <label>Телефон</label>
        <input
          type="tel"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: formatUzPhone(e.target.value) })}
          placeholder="+998-99-302-53-45"
        />
      </div>
      <div className="form-group">
        <label>Email</label>
        <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </div>
      <div className="form-group">
        <label>Telegram Chat ID</label>
        <input
          value={form.telegram_chat_id}
          onChange={(e) => setForm({ ...form, telegram_chat_id: e.target.value })}
          placeholder="Получить через /start в боте"
        />
      </div>
      <div className="form-group full">
        <label>Адрес</label>
        <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      </div>
      <div className="form-group full">
        <label>Заметки</label>
        <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>
      <div className="form-group">
        <label>Начальное сальдо</label>
        <input
          type="text"
          inputMode="numeric"
          value={formatPriceInput(form.opening_balance ?? 0)}
          onChange={(e) => setForm({
            ...form,
            opening_balance: parsePriceInput(e.target.value) ?? 0,
          })}
        />
        <small className="text-muted" style={{ display: 'block', marginTop: 4 }}>
          Удобнее задавать в документе «Начальное сальдо»
        </small>
      </div>
    </div>
  );
}

export const emptyCounterpartyForm = {
  name: '',
  type: 'supplier',
  phone: '',
  email: '',
  telegram_chat_id: '',
  address: '',
  notes: '',
  opening_balance: 0,
};
