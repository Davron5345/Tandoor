import { formatPriceInput, parsePriceInput } from '../api';
import { formatUzPhone } from '../phoneFormat';

export default function CounterpartyFormFields({ form, setForm, lockType = null }) {
  const typeLocked = lockType === 'supplier' || lockType === 'client';
  const isSupplier = (typeLocked ? lockType : form.type) === 'supplier';

  return (
    <div className="form-grid form-grid-compact">
      <div className="form-group">
        <label>{isSupplier ? 'Название поставщика *' : 'Название *'}</label>
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder={isSupplier ? 'Напр. Мурод' : ''}
        />
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
      {!isSupplier && (
        <div className="form-group">
          <label>ИНН</label>
          <input
            value={form.inn || ''}
            onChange={(e) => setForm({ ...form, inn: e.target.value.replace(/\D/g, '').slice(0, 9) })}
            placeholder="123456789"
            inputMode="numeric"
            maxLength={9}
          />
        </div>
      )}
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
        <label>Telegram</label>
        <input
          value={form.telegram_chat_id}
          onChange={(e) => setForm({ ...form, telegram_chat_id: e.target.value })}
          placeholder="Chat ID"
        />
      </div>
      <div className="form-group">
        <label>Адрес</label>
        <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      </div>
      <div className="form-group">
        <label title="Удобнее задавать в документе «Начальное сальдо»">Сальдо</label>
        <input
          type="text"
          inputMode="numeric"
          value={formatPriceInput(form.opening_balance ?? 0)}
          onChange={(e) => setForm({
            ...form,
            opening_balance: parsePriceInput(e.target.value) ?? 0,
          })}
        />
      </div>
      <div className="form-group full">
        <label>Заметки</label>
        <input
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          placeholder="Кратко"
        />
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
  inn: '',
  opening_balance: 0,
};
