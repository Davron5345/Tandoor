import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, formatMoney, formatDate } from '../api';
import { PAYMENT_TYPES } from '../permissions';
import Modal, { useToast } from '../components/Modal';
import { hasPermission } from '../permissions';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { IconButton, IconEye, IconEdit, IconTrash } from '../components/ActionIcons';

const INCOME_TYPES = new Set(['customer_income', 'other_income']);

const empty = {
  type: 'supplier_payment',
  counterparty_id: '',
  document_id: '',
  amount: 0,
  date: new Date().toISOString().slice(0, 10),
  comment: '',
  bank_account_id: '',
};

function dayStatus(items) {
  const imported = items.filter((p) => p.import_batch_id).length;
  if (!items.length) return { key: 'draft', label: 'Пусто' };
  if (imported === items.length) return { key: 'confirmed', label: 'Загружена' };
  if (imported === 0) return { key: 'draft', label: 'Вручную' };
  return { key: 'supplier', label: 'Смешанная' };
}

function sumDay(items) {
  let credit = 0; // приход / оборот кредит
  let debit = 0; // расход / оборот дебет
  for (const p of items) {
    const amt = Number(p.amount) || 0;
    if (INCOME_TYPES.has(p.type)) credit += amt;
    else debit += amt;
  }
  return { credit, debit, income: credit, expense: debit };
}

function isCreditPayment(p) {
  return INCOME_TYPES.has(p.type);
}

export default function Payments() {
  const [payments, setPayments] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [accountModal, setAccountModal] = useState(null);
  const [accountForm, setAccountForm] = useState({
    name: '', account_number: '', currency: 'UZS', is_default: false,
  });
  const [openingBank, setOpeningBank] = useState(0);
  const [counterparties, setCounterparties] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [viewDay, setViewDay] = useState(null);
  const [paymentModal, setPaymentModal] = useState(null);
  const [form, setForm] = useState(empty);
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [importRows, setImportRows] = useState([]);
  const [importMeta, setImportMeta] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importFilter, setImportFilter] = useState('all');
  const [importOpen, setImportOpen] = useState(false);
  const fileRef = useRef(null);
  const { show, Toast } = useToast();
  const { user } = useAuth();
  const { branchName, branchId } = useBranch();
  const canEdit = hasPermission(user, 'payments.edit');
  const canDelete = hasPermission(user, 'payments.delete');

  const loadAccounts = useCallback(async () => {
    try {
      const list = await api.getBankAccounts({ active: '1' });
      setBankAccounts(Array.isArray(list) ? list : []);
      setSelectedAccountId((prev) => {
        if (prev && list.some((a) => a.id === prev)) return prev;
        const def = list.find((a) => a.is_default) || list[0];
        return def?.id || '';
      });
    } catch (err) {
      console.error(err);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const accountId = selectedAccountId;
      const [p, bankOpen] = await Promise.all([
        api.getPayments(accountId ? { bank_account_id: accountId } : {}),
        api.getBankOpening(accountId || undefined).catch(() => ({ opening_bank: 0 })),
      ]);
      setPayments(Array.isArray(p) ? p : (p?.items || []));
      setOpeningBank(Number(bankOpen?.opening_bank) || 0);
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
  }, [show, selectedAccountId]);

  useEffect(() => { loadAccounts(); }, [loadAccounts, branchId]);
  useEffect(() => { load(); }, [load, branchId]);
  useAutoRefresh(load, [load, branchId], {
    enabled: !importOpen && !viewDay && !paymentModal && !accountModal,
  });

  const selectedAccount = useMemo(
    () => bankAccounts.find((a) => a.id === selectedAccountId) || null,
    [bankAccounts, selectedAccountId],
  );

  const allDaysWithBalances = useMemo(() => {
    const map = new Map();
    for (const p of payments) {
      const d = p.date;
      if (!d) continue;
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(p);
    }
    const datesAsc = [...map.keys()].sort((a, b) => (a < b ? -1 : 1));
    let running = openingBank;
    return datesAsc.map((date) => {
      const items = map.get(date);
      const { credit, debit } = sumDay(items);
      const opening = running;
      const closing = opening + credit - debit;
      running = closing;
      return {
        date,
        items,
        count: items.length,
        credit,
        debit,
        income: credit,
        expense: debit,
        opening,
        closing,
        status: dayStatus(items),
      };
    });
  }, [payments, openingBank]);

  const paymentDays = useMemo(() => {
    const filtered = allDaysWithBalances.filter((day) => {
      if (filterDateFrom && day.date < filterDateFrom) return false;
      if (filterDateTo && day.date > filterDateTo) return false;
      return true;
    });
    const desc = [...filtered].reverse();
    return desc.map((day, idx) => ({ ...day, number: desc.length - idx }));
  }, [allDaysWithBalances, filterDateFrom, filterDateTo]);

  const dayDoc = useMemo(
    () => (viewDay ? allDaysWithBalances.find((d) => d.date === viewDay) : null),
    [allDaysWithBalances, viewDay],
  );

  const dayItems = useMemo(() => {
    if (!viewDay) return [];
    return payments
      .filter((p) => p.date === viewDay)
      .slice()
      .sort((a, b) => (b.number || 0) - (a.number || 0));
  }, [payments, viewDay]);

  const dayTotals = useMemo(() => (
    dayDoc
      ? { credit: dayDoc.credit, debit: dayDoc.debit, income: dayDoc.credit, expense: dayDoc.debit }
      : sumDay(dayItems)
  ), [dayDoc, dayItems]);
  const dayStatusInfo = useMemo(
    () => (dayDoc ? dayDoc.status : dayStatus(dayItems)),
    [dayDoc, dayItems],
  );

  const openCreate = (dateOverride) => {
    setForm({
      ...empty,
      date: dateOverride || viewDay || empty.date,
      bank_account_id: selectedAccountId || '',
    });
    setPaymentModal('create');
  };

  const openEdit = (p) => {
    setForm({
      type: p.type,
      counterparty_id: p.counterparty_id || '',
      document_id: p.document_id || '',
      amount: p.amount,
      date: p.date,
      comment: p.comment || '',
      bank_account_id: p.bank_account_id || selectedAccountId || '',
    });
    setPaymentModal(p.id);
  };

  const save = async () => {
    try {
      const payload = {
        ...form,
        bank_account_id: form.bank_account_id || selectedAccountId || null,
      };
      if (paymentModal === 'create') {
        await api.createPayment(payload);
        show('Оплата добавлена');
        if (!viewDay && form.date) setViewDay(form.date);
      } else {
        await api.updatePayment(paymentModal, payload);
        show('Оплата обновлена');
        if (viewDay && form.date && form.date !== viewDay) {
          setViewDay(form.date);
        }
      }
      setPaymentModal(null);
      await load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const remove = async (p) => {
    if (!window.confirm(`Удалить оплату №${p.number}?`)) return;
    try {
      await api.deletePayment(p.id);
      show('Удалено');
      const next = payments.filter((x) => x.id !== p.id);
      setPayments(next);
      if (viewDay && !next.some((x) => x.date === viewDay)) setViewDay(null);
      await load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const removeDay = async (date) => {
    const day = allDaysWithBalances.find((d) => d.date === date);
    const count = day?.count || payments.filter((p) => p.date === date).length;
    if (!window.confirm(
      `Удалить выписку за ${formatDate(date)}?\nБудут удалены все операции этого дня (${count}).`,
    )) return;
    try {
      const result = await api.deleteBankDay(date, selectedAccountId || undefined);
      show(`Удалено операций: ${result.deleted_count || 0}`);
      if (viewDay === date) setViewDay(null);
      await load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const onPickStatement = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportBusy(true);
    try {
      const preview = await api.parseBankStatement(file);
      setImportRows((preview.rows || []).map((r) => ({ ...r })));
      setImportMeta(preview);
      setImportFilter('all');
      setImportOpen(true);
      if (preview.account_missing || preview.account_missing_message) {
        show(preview.account_missing_message || 'Счёт из выписки не найден в справочнике', 'error');
      } else if (preview.bank_account) {
        setSelectedAccountId(preview.bank_account.id);
      }
      const existing = preview.existing_dates || [];
      const diffs = existing.filter((d) => d.has_differences);
      const same = existing.filter((d) => d.identical);
      if (preview.account_missing) {
        /* already shown */
      } else if (diffs.length > 0) {
        show(
          `Даты уже есть и отличаются (${diffs.map((d) => formatDate(d.date)).join(', ')}). `
          + 'При сохранении выписка за эти дни будет заменена.',
          'error',
        );
      } else if (same.length > 0) {
        show(`Без изменений: ${same.map((d) => formatDate(d.date)).join(', ')} — уже загружено`, 'error');
      } else if (preview.new_firms_count > 0) {
        show(`Найдено новых фирм: ${preview.new_firms_count} — создадутся при сохранении`, 'error');
      } else if (preview.new_accounts_count > 0) {
        show(`Найдено новых р/с: ${preview.new_accounts_count} — запишутся на фирмы при сохранении`, 'error');
      } else if (!preview.retail_client) {
        show('Создайте клиента «КЛИЕНТ» и договоры Click / Payme / Терминал — для эквайринга', 'error');
      }
    } catch (err) {
      show(err.message || 'Не удалось разобрать выписку', 'error');
    } finally {
      setImportBusy(false);
    }
  };

  const visibleImportRows = useMemo(() => {
    if (importFilter === 'selected') return importRows.filter((r) => r.selected);
    if (importFilter === 'debit') return importRows.filter((r) => r.direction === 'debit');
    if (importFilter === 'credit') return importRows.filter((r) => r.direction === 'credit');
    if (importFilter === 'new') return importRows.filter((r) => r.is_new_firm && !r.counterparty_id);
    if (importFilter === 'new_account') return importRows.filter((r) => r.is_new_account);
    if (importFilter === 'unmatched') {
      return importRows.filter((r) => !r.counterparty_id && !r.already_imported);
    }
    return importRows;
  }, [importRows, importFilter]);

  const importRowsByDate = useMemo(() => {
    const sorted = [...visibleImportRows].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return String(a.external_ref || '').localeCompare(String(b.external_ref || ''));
    });
    const groups = [];
    let current = null;
    for (const r of sorted) {
      if (!current || current.date !== r.date) {
        current = { date: r.date, rows: [] };
        groups.push(current);
      }
      current.rows.push(r);
    }
    return groups;
  }, [visibleImportRows]);

  const selectedImportCount = importRows.filter((r) => r.selected && !r.already_imported).length;
  const replaceDatesLive = useMemo(() => {
    const fromMeta = importMeta?.existing_dates || [];
    return fromMeta.filter((d) => d.has_differences);
  }, [importMeta]);
  const identicalDatesLive = useMemo(() => {
    const fromMeta = importMeta?.existing_dates || [];
    return fromMeta.filter((d) => d.identical);
  }, [importMeta]);

  const newFirmsLive = useMemo(() => {
    const map = new Map();
    for (const r of importRows) {
      if (!r.is_new_firm || r.counterparty_id || r.already_imported) continue;
      const key = r.inn || r.suggested_name || r.name;
      if (!key || map.has(key)) continue;
      map.set(key, {
        inn: r.inn,
        name: r.suggested_name || r.name,
        account: r.account || null,
        type: r.suggested_type,
      });
    }
    return [...map.values()];
  }, [importRows]);

  const newAccountsLive = useMemo(() => {
    const map = new Map();
    for (const r of importRows) {
      if (!r.is_new_account || r.already_imported || !r.firm_id) continue;
      const acc = String(r.account || '').replace(/\D/g, '') || r.account;
      if (!acc) continue;
      const key = `${r.firm_id}:${acc}`;
      if (map.has(key)) continue;
      map.set(key, {
        firm_name: r.firm_name || r.suggested_name || r.name,
        inn: r.inn,
        account: acc,
        previous_account: r.firm_bank_account || null,
      });
    }
    return [...map.values()];
  }, [importRows]);

  const updateImportRow = (externalRef, patch) => {
    setImportRows((rows) => rows.map((r) => {
      if (r.external_ref !== externalRef) return r;
      const next = { ...r, ...patch };
      if (Object.prototype.hasOwnProperty.call(patch, 'counterparty_id')) {
        if (patch.counterparty_id) {
          next.is_new_firm = false;
        } else if (r.inn || r.suggested_name) {
          next.is_new_firm = true;
          next.is_new_account = false;
        }
      }
      return next;
    }));
  };

  const toggleAllVisible = (checked) => {
    const ids = new Set(visibleImportRows.map((r) => r.external_ref));
    setImportRows((rows) => rows.map((r) => (
      ids.has(r.external_ref) && !r.already_imported
        ? { ...r, selected: checked }
        : r
    )));
  };

  const closeImport = (force = false) => {
    if (importBusy && !force) return;
    setImportOpen(false);
    setImportRows([]);
    setImportMeta(null);
  };

  const confirmImport = async () => {
    const saveRows = importRows.filter((r) => r.selected && !r.already_imported);
    if (!saveRows.length) {
      show('Отметьте хотя бы одну строку', 'error');
      return;
    }
    if (importMeta?.account_missing || !importMeta?.bank_account?.id) {
      show(importMeta?.account_missing_message
        || 'Сначала создайте банковский счёт с р/с из выписки', 'error');
      return;
    }
    const bankAccountId = importMeta.bank_account.id;
    const replaceDates = [
      ...new Set([
        ...(importMeta?.replace_dates || []),
        ...saveRows.filter((r) => r.replaces_date).map((r) => r.date),
      ].filter(Boolean)),
    ];
    if (replaceDates.length) {
      const ok = window.confirm(
        `Заменить выписки за даты:\n${replaceDates.map((d) => formatDate(d)).join(', ')}\n\n`
        + 'Старые операции этих дней будут удалены и записаны заново. Продолжить?',
      );
      if (!ok) return;
    }
    setImportBusy(true);
    try {
      const result = await api.confirmBankStatement(saveRows, {
        replace_dates: replaceDates,
        bank_account_id: bankAccountId,
      });
      setSelectedAccountId(bankAccountId);
      await loadAccounts();
      const firmMsg = result.created_counterparties_count
        ? `, новых фирм: ${result.created_counterparties_count}`
        : '';
      const accMsg = result.updated_accounts_count
        ? `, новых р/с: ${result.updated_accounts_count}`
        : '';
      const replMsg = result.replaced_dates_count
        ? `, заменено дней: ${result.replaced_dates_count}`
        : '';
      const dates = new Set(saveRows.map((r) => r.date).filter(Boolean));
      show(`Создано операций: ${result.created_count}${firmMsg}${accMsg}${replMsg}`
        + (result.skipped_count ? `, пропущено: ${result.skipped_count}` : '')
        + (dates.size ? ` · дней: ${dates.size}` : ''));
      closeImport(true);
      await load();
    } catch (err) {
      show(err.message || 'Ошибка импорта', 'error');
    } finally {
      setImportBusy(false);
    }
  };

  const filteredCp = counterparties.filter((c) => {
    if (form.type === 'supplier_payment') return c.type === 'supplier';
    if (form.type === 'customer_income') return c.type === 'client';
    return true;
  });

  const counterpartiesForImportRow = (row) => {
    if (row.type === 'supplier_payment') return counterparties.filter((c) => c.type === 'supplier');
    if (row.type === 'customer_income') return counterparties.filter((c) => c.type === 'client');
    return counterparties;
  };

  return (
    <div>
      {Toast}
      <div className="page-header">
        <h1>Банк{branchName ? ` · ${branchName}` : ''}</h1>
        {canEdit && (
          <div className="btn-group">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={importBusy}
              onClick={() => fileRef.current?.click()}
            >
              {importBusy && !importOpen ? 'Чтение…' : 'Загрузить выписку'}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => openCreate()}>
              + Новая операция
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              style={{ display: 'none' }}
              onChange={onPickStatement}
            />
          </div>
        )}
      </div>

      <div className="filters">
        <label className="filter-field">
          <span className="filter-field-caption">Счёт</span>
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
          >
            {bankAccounts.length === 0 && <option value="">— нет счетов —</option>}
            {bankAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.account_number} ({a.currency || 'UZS'})
              </option>
            ))}
          </select>
        </label>
        {canEdit && (
          <div className="filter-field filter-field-actions">
            <span className="filter-field-caption filter-field-caption-spacer" aria-hidden="true">&#8203;</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setAccountForm({
                  name: '',
                  account_number: importMeta?.own_account || '',
                  currency: 'UZS',
                  is_default: bankAccounts.length === 0,
                });
                setAccountModal('create');
              }}
            >
              + Счёт
            </button>
          </div>
        )}
        <label className="filter-field">
          <span className="filter-field-caption">С</span>
          <input
            type="date"
            value={filterDateFrom}
            max={filterDateTo || undefined}
            onChange={(e) => setFilterDateFrom(e.target.value)}
          />
        </label>
        <label className="filter-field">
          <span className="filter-field-caption">По</span>
          <input
            type="date"
            value={filterDateTo}
            min={filterDateFrom || undefined}
            onChange={(e) => setFilterDateTo(e.target.value)}
          />
        </label>
        {(filterDateFrom || filterDateTo) && (
          <div className="filter-field filter-field-actions">
            <span className="filter-field-caption filter-field-caption-spacer" aria-hidden="true">&#8203;</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => { setFilterDateFrom(''); setFilterDateTo(''); }}
            >
              Сбросить
            </button>
          </div>
        )}
      </div>

      {selectedAccount && (
        <p className="bank-list-footnote text-muted" style={{ marginTop: 0, paddingTop: 0 }}>
          Сальдо по счёту «{selectedAccount.name}» · р/с {selectedAccount.account_number}
          {' · '}
          нач. {formatMoney(openingBank)}
        </p>
      )}

      <div className="card">
        <div className="table-wrap">
          <table className="bank-days-table">
            <thead>
              <tr>
                <th>Номер</th>
                <th>Дата</th>
                <th>Тип</th>
                <th>Операций</th>
                <th className="num">Сальдо нач.</th>
                <th className="num">Дебет<br /><span className="th-sub">расход</span></th>
                <th className="num">Кредит<br /><span className="th-sub">приход</span></th>
                <th className="num">Сальдо кон.</th>
                <th>Статус</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {paymentDays.map((day) => (
                <tr key={day.date}>
                  <td>{day.number}</td>
                  <td>{formatDate(day.date)}</td>
                  <td>
                    <span className="badge badge-supplier">Выписка</span>
                  </td>
                  <td>{day.count}</td>
                  <td className="num">{formatMoney(day.opening)}</td>
                  <td className="num bank-amt-debit">{day.debit ? formatMoney(day.debit) : '—'}</td>
                  <td className="num bank-amt-credit">{day.credit ? formatMoney(day.credit) : '—'}</td>
                  <td className="num"><strong>{formatMoney(day.closing)}</strong></td>
                  <td>
                    <span className={`badge badge-${day.status.key}`}>{day.status.label}</span>
                  </td>
                  <td>
                    <div className="btn-group btn-group-icons doc-actions">
                      <IconButton title="Открыть" onClick={() => setViewDay(day.date)}>
                        <IconEye />
                      </IconButton>
                      {canDelete && (
                        <IconButton title="Удалить выписку" danger onClick={() => removeDay(day.date)}>
                          <IconTrash />
                        </IconButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {paymentDays.length === 0 && (
                <tr>
                  <td colSpan={10} className="empty">
                    {payments.length === 0 ? 'Операций пока нет' : 'Нет выписок за выбранный период'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {paymentDays.length > 0 && (
          <div className="bank-list-footnote text-muted">
            Сальдо от начального остатка банка
            {' '}
            ({formatMoney(openingBank)}
            )
            {' '}
            + обороты по дням. Дебет = расход, кредит = приход.
          </div>
        )}
      </div>

      {viewDay && (
        <Modal
          title={`Выписка · ${formatDate(viewDay)}`}
          wide
          className="modal-bank-day"
          onClose={() => setViewDay(null)}
          footer={
            <>
              {canDelete && (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => removeDay(viewDay)}
                >
                  Удалить выписку
                </button>
              )}
              <button type="button" className="btn btn-ghost" onClick={() => setViewDay(null)}>
                Закрыть
              </button>
              {canEdit && (
                <button type="button" className="btn btn-primary" onClick={() => openCreate(viewDay)}>
                  + Операция
                </button>
              )}
            </>
          }
        >
          <div className="bank-day-layout">
            <div className="bank-day-summary">
              <div className="bank-day-summary-item">
                <span className="bank-day-summary-label">Сальдо на начало</span>
                <strong>{formatMoney(dayDoc?.opening ?? openingBank)}</strong>
              </div>
              <div className="bank-day-summary-item">
                <span className="bank-day-summary-label">Оборот дебет (расход)</span>
                <strong className="bank-amt-debit">{formatMoney(dayTotals.debit)}</strong>
              </div>
              <div className="bank-day-summary-item">
                <span className="bank-day-summary-label">Оборот кредит (приход)</span>
                <strong className="bank-amt-credit">{formatMoney(dayTotals.credit)}</strong>
              </div>
              <div className="bank-day-summary-item">
                <span className="bank-day-summary-label">Сальдо на конец</span>
                <strong>{formatMoney(dayDoc?.closing ?? ((dayDoc?.opening ?? openingBank) + dayTotals.credit - dayTotals.debit))}</strong>
              </div>
            </div>
            <div className="bank-day-meta">
              <span className={`badge badge-${dayStatusInfo.key}`}>{dayStatusInfo.label}</span>
              <span className="text-muted">Операций: {dayItems.length}</span>
            </div>
            <div className="table-wrap bank-day-table">
              <table>
                <thead>
                  <tr>
                    <th>№</th>
                    <th>Тип</th>
                    <th>Контрагент</th>
                    <th>Договор</th>
                    <th>Документ</th>
                    <th className="num">Дебет</th>
                    <th className="num">Кредит</th>
                    <th>Комментарий</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {dayItems.map((p) => {
                    const credit = isCreditPayment(p);
                    return (
                      <tr key={p.id}>
                        <td>{p.number}</td>
                        <td>{PAYMENT_TYPES[p.type] || p.type}</td>
                        <td>{p.counterparty_name || '—'}</td>
                        <td>{p.contract_number || '—'}</td>
                        <td>{p.document_number || '—'}</td>
                        <td className="num bank-amt-debit">
                          {!credit && p.amount ? formatMoney(p.amount) : '—'}
                        </td>
                        <td className="num bank-amt-credit">
                          {credit && p.amount ? formatMoney(p.amount) : '—'}
                        </td>
                        <td className="bank-day-comment" title={p.comment || ''}>
                          {(p.comment || '').slice(0, 80)}
                          {(p.comment || '').length > 80 ? '…' : ''}
                        </td>
                        <td>
                          {canEdit && (
                            <div className="btn-group btn-group-icons">
                              <IconButton title="Изменить" onClick={() => openEdit(p)}>
                                <IconEdit />
                              </IconButton>
                              {canDelete && (
                                <IconButton title="Удалить" danger onClick={() => remove(p)}>
                                  <IconTrash />
                                </IconButton>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {dayItems.length === 0 && (
                    <tr><td colSpan={9} className="empty">Нет операций за этот день</td></tr>
                  )}
                </tbody>
                {dayItems.length > 0 && (
                  <tfoot>
                    <tr className="bank-day-totals-row">
                      <td colSpan={5}><strong>Итого оборот</strong></td>
                      <td className="num bank-amt-debit"><strong>{formatMoney(dayTotals.debit)}</strong></td>
                      <td className="num bank-amt-credit"><strong>{formatMoney(dayTotals.credit)}</strong></td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </Modal>
      )}

      {importOpen && (
        <Modal
          title="Импорт банковской выписки"
          wide
          className="modal-bank-import"
          onClose={closeImport}
          footer={
            <>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={importBusy}
                onClick={closeImport}
              >
                Отмена
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={importBusy || selectedImportCount === 0 || importMeta?.account_missing}
                onClick={confirmImport}
              >
                {importBusy
                  ? 'Сохранение…'
                  : (replaceDatesLive.length
                    ? `Заменить и сохранить (${selectedImportCount})`
                    : `Сохранить (${selectedImportCount})`)}
              </button>
            </>
          }
        >
          <div className="bank-import-layout">
            <p className="bank-import-hint">
              Формат: {importMeta?.format || 'AccReferenceReport'} ({importMeta?.bank || 'Ipak Yuli'}).
              {importMeta?.own_account
                ? ` Р/с из файла: ${importMeta.own_account}${importMeta.bank_account ? ` → «${importMeta.bank_account.name}»` : ''}.`
                : ' Номер своего р/с в файле не найден.'}
              {importMeta?.retail_client
                ? ` Эквайринг → «${importMeta.retail_client.name}».`
                : ' Нет клиента «КЛИЕНТ» — Click/Payme/терминал не привяжутся автоматически.'}
              {' '}
              Одна дата — одна выписка по счёту.
            </p>

            {importMeta?.account_missing && (
              <div className="alert alert-error bank-import-new-firms" role="status">
                <strong>Счёт не найден:</strong>
                {' '}
                {importMeta.account_missing_message}
                {canEdit && (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setAccountForm({
                          name: importMeta.own_name || 'Основной сумовый',
                          account_number: importMeta.own_account || '',
                          currency: 'UZS',
                          is_default: bankAccounts.length === 0,
                        });
                        setAccountModal('create');
                      }}
                    >
                      Создать счёт {importMeta.own_account}
                    </button>
                  </>
                )}
              </div>
            )}

            {replaceDatesLive.length > 0 && (
              <div className="alert alert-error bank-import-new-firms" role="status">
                <strong>Даты уже есть — будут заменены ({replaceDatesLive.length}):</strong>
                {' '}
                {replaceDatesLive.map((d) => (
                  `${formatDate(d.date)} (было ${d.existing_count} → станет ${d.new_count}`
                  + (d.added || d.removed || d.changed
                    ? `; +${d.added}/−${d.removed}/≠${d.changed}`
                    : '')
                  + (d.has_manual ? '; есть ручные' : '')
                  + ')'
                )).join('; ')}.
                {' '}
                Старые операции этих дней удалятся при сохранении.
              </div>
            )}

            {identicalDatesLive.length > 0 && (
              <div className="alert alert-warning bank-import-new-accounts" role="status">
                <strong>Без изменений ({identicalDatesLive.length}):</strong>
                {' '}
                {identicalDatesLive.map((d) => formatDate(d.date)).join(', ')}
                {' — '}
                уже загружено, строки сняты с выбора.
              </div>
            )}

            {newFirmsLive.length > 0 && (
              <div className="alert alert-error bank-import-new-firms" role="status">
                <strong>Новые фирмы ({newFirmsLive.length}):</strong>
                {' '}
                при сохранении будут добавлены в справочник —
                {' '}
                {newFirmsLive.map((f) => `${f.name}${f.inn ? ` (${f.inn})` : ''}${f.account ? `, р/с ${f.account}` : ''}`).join('; ')}.
                Можно вручную выбрать существующего контрагента в строке.
              </div>
            )}

            {newAccountsLive.length > 0 && (
              <div className="alert alert-warning bank-import-new-accounts" role="status">
                <strong>Новые р/с ({newAccountsLive.length}):</strong>
                {' '}
                ИНН и название совпали, счёт другой — при сохранении р/с обновится у фирмы —
                {' '}
                {newAccountsLive.map((a) => (
                  `${a.firm_name}${a.inn ? ` (${a.inn})` : ''}: ${a.account}${a.previous_account ? ` (был ${a.previous_account})` : ''}`
                )).join('; ')}.
              </div>
            )}

            <div className="bank-import-toolbar form-grid">
              <div className="form-group">
                <label>Фильтр</label>
                <select value={importFilter} onChange={(e) => setImportFilter(e.target.value)}>
                  <option value="all">Все ({importRows.length})</option>
                  <option value="selected">Выбранные ({selectedImportCount})</option>
                  <option value="new">Новые фирмы ({newFirmsLive.length})</option>
                  <option value="new_account">Новые р/с ({newAccountsLive.length})</option>
                  <option value="debit">Расход (дебет)</option>
                  <option value="credit">Приход (кредит)</option>
                  <option value="unmatched">Без контрагента</option>
                </select>
              </div>
              <div className="form-group bank-import-toolbar-actions">
                <label>&nbsp;</label>
                <div className="btn-group">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => toggleAllVisible(true)}>
                    Выбрать видимые
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggleAllVisible(false)}>
                    Снять видимые
                  </button>
                </div>
              </div>
            </div>

            <div className="table-wrap bank-import-table">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>Дата</th>
                    <th>Сумма</th>
                    <th>Тип</th>
                    <th>ИНН</th>
                    <th>Контрагент</th>
                    <th>Договор / канал</th>
                    <th>Назначение</th>
                  </tr>
                </thead>
                <tbody>
                  {importRowsByDate.map((group) => (
                    <ImportDateGroup
                      key={group.date || 'nodate'}
                      group={group}
                      counterpartiesForImportRow={counterpartiesForImportRow}
                      updateImportRow={updateImportRow}
                    />
                  ))}
                  {importRowsByDate.length === 0 && (
                    <tr><td colSpan={8} className="empty">Нет строк</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </Modal>
      )}

      {paymentModal && (
        <Modal
          title={paymentModal === 'create' ? 'Новая операция' : 'Редактировать операцию'}
          onClose={() => setPaymentModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setPaymentModal(null)}>Отмена</button>
              <button type="button" className="btn btn-primary" onClick={save}>Сохранить</button>
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
                  <option key={c.id} value={c.id}>{c.name}{c.inn ? ` (${c.inn})` : ''}</option>
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
            <div className="form-group">
              <label>Банковский счёт</label>
              <select
                value={form.bank_account_id || selectedAccountId || ''}
                onChange={(e) => setForm({ ...form, bank_account_id: e.target.value })}
              >
                <option value="">— не выбран —</option>
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.account_number}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group full">
              <label>Комментарий</label>
              <textarea rows={2} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} />
            </div>
          </div>
        </Modal>
      )}

      {accountModal && (
        <Modal
          title="Новый банковский счёт"
          onClose={() => setAccountModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setAccountModal(null)}>Отмена</button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  try {
                    const created = await api.createBankAccount(accountForm);
                    show('Счёт создан');
                    setAccountModal(null);
                    await loadAccounts();
                    if (created?.id) setSelectedAccountId(created.id);
                    if (importOpen && importMeta?.own_account) {
                      show('Счёт создан — загрузите выписку снова для привязки', 'error');
                    }
                  } catch (e) {
                    show(e.message, 'error');
                  }
                }}
              >
                Сохранить
              </button>
            </>
          }
        >
          <div className="form-grid">
            <div className="form-group full">
              <label>Название *</label>
              <input
                value={accountForm.name}
                onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
                placeholder="Основной сумовый"
              />
            </div>
            <div className="form-group">
              <label>Р/с *</label>
              <input
                value={accountForm.account_number}
                onChange={(e) => setAccountForm({ ...accountForm, account_number: e.target.value })}
                placeholder="20208000…"
              />
            </div>
            <div className="form-group">
              <label>Валюта</label>
              <select
                value={accountForm.currency}
                onChange={(e) => setAccountForm({ ...accountForm, currency: e.target.value })}
              >
                <option value="UZS">UZS</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
            <div className="form-group full">
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(accountForm.is_default)}
                  onChange={(e) => setAccountForm({ ...accountForm, is_default: e.target.checked })}
                />
                {' '}
                Счёт по умолчанию
              </label>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ImportDateGroup({ group, counterpartiesForImportRow, updateImportRow }) {
  return (
    <>
      <tr className="bank-import-date-header">
        <td colSpan={8}>
          <strong>{formatDate(group.date)}</strong>
          <span className="text-muted"> · {group.rows.length} опер.</span>
        </td>
      </tr>
      {group.rows.map((r) => (
        <tr
          key={r.external_ref}
          className={
            r.is_new_firm && !r.counterparty_id
              ? 'bank-import-row-new'
              : (r.is_new_account ? 'bank-import-row-new-account' : undefined)
          }
          style={r.already_imported ? { opacity: 0.55 } : undefined}
        >
          <td>
            <input
              type="checkbox"
              checked={Boolean(r.selected)}
              disabled={r.already_imported}
              onChange={(e) => updateImportRow(r.external_ref, { selected: e.target.checked })}
            />
          </td>
          <td>{formatDate(r.date)}</td>
          <td>
            {r.direction === 'debit' ? '−' : '+'}
            {formatMoney(r.amount)}
          </td>
          <td>
            <select
              value={r.type}
              disabled={r.already_imported}
              onChange={(e) => updateImportRow(r.external_ref, {
                type: e.target.value,
                counterparty_id: '',
                counterparty_name: null,
                is_new_firm: Boolean(r.inn || r.suggested_name),
              })}
            >
              {Object.entries(PAYMENT_TYPES).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </td>
          <td>{r.inn || '—'}</td>
          <td>
            <select
              value={r.counterparty_id || ''}
              disabled={r.already_imported}
              onChange={(e) => {
                const id = e.target.value || null;
                const list = counterpartiesForImportRow(r);
                const cp = list.find((c) => c.id === id);
                updateImportRow(r.external_ref, {
                  counterparty_id: id,
                  counterparty_name: cp?.name || null,
                });
              }}
              title={r.match_reason || ''}
            >
              <option value="">
                {r.is_new_firm
                  ? `+ Создать: ${r.suggested_name || r.name}${r.inn ? ` (${r.inn})` : ''}`
                  : '— не выбран —'}
              </option>
              {counterpartiesForImportRow(r).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.inn ? ` (${c.inn})` : ''}
                </option>
              ))}
            </select>
            <div className="text-muted bank-import-match-reason">
              {r.match_reason || r.name}
            </div>
          </td>
          <td>{r.contract_number || r.channel_label || '—'}</td>
          <td className="bank-import-purpose" title={r.purpose}>
            {(r.purpose || '').slice(0, 120)}{(r.purpose || '').length > 120 ? '…' : ''}
          </td>
        </tr>
      ))}
    </>
  );
}
