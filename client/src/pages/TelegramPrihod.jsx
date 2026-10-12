import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api, formatDate, formatMoney, formatPriceInput, formatQty, parsePriceInput, STATUS_LABELS,
} from '../api';
import Modal, { useToast, ModalCancelButton } from '../components/Modal';
import ProductSelect from '../components/ProductSelect';
import CounterpartySearchSelect from '../components/CounterpartySearchSelect';
import { encodeProductPick, resolvePickFromProducts } from '../utils/productVariants';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';
import { hasPermission } from '../permissions';
import { todayLocalIso } from '../utils/date';

const STATUS_FILTERS = [
  { id: 'pending', label: 'Ждут проверки' },
  { id: 'created', label: 'Созданы' },
  { id: 'ignored', label: 'Пропущены' },
  { id: '', label: 'Все' },
];

function parseQtyInput(value) {
  const n = Number(String(value ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function messageTime(at) {
  if (!at) return '';
  const time = String(at).split('T')[1];
  return time ? time.slice(0, 5) : '';
}

function entrySource(entry) {
  if (entry.source === 'paste') return 'Вставлено вручную';
  return [entry.chat_title, entry.topic_title].filter(Boolean).join(' · ') || 'Telegram';
}

function EntryStatus({ entry }) {
  if (entry.status === 'created') {
    return (
      <span className={`badge badge-${entry.document_status || 'draft'}`}>
        Приход №{entry.document_number} · {STATUS_LABELS[entry.document_status] || 'черновик'}
      </span>
    );
  }
  if (entry.status === 'ignored') return <span className="badge badge-cancelled">Пропущено</span>;
  if (entry.status === 'error') return <span className="badge badge-cancelled">Ошибка</span>;
  if (entry.analysis?.ready) return <span className="badge badge-confirmed">Готово к созданию</span>;
  return <span className="badge badge-draft">Нужно сопоставить</span>;
}

function EntryCard({ entry, onReview, onStatus }) {
  const { analysis } = entry;
  const pending = entry.status === 'new' || entry.status === 'error';
  return (
    <div className={`tg-prihod-card${pending ? ' is-pending' : ''}`}>
      <div className="tg-prihod-card-head">
        <div>
          <strong>{formatDate(entry.doc_date)}</strong>
          {messageTime(entry.message_at) && <span className="muted"> {messageTime(entry.message_at)}</span>}
          {entry.from_name && <span> · {entry.from_name}</span>}
          <div className="muted tg-prihod-card-source">
            {entrySource(entry)}
            {entry.department_name ? ` → ${entry.department_name}` : ''}
            {entry.edited ? ' · изменено' : ''}
          </div>
        </div>
        <EntryStatus entry={entry} />
      </div>

      <div className="tg-prihod-card-body">
        <pre className="tg-prihod-text">{entry.text}</pre>
        <div className="tg-prihod-parsed">
          <div className="tg-prihod-parsed-row">
            <span className="muted">Поставщик:</span>{' '}
            {!analysis.supplier ? (
              <span className="tg-prihod-miss">не указан</span>
            ) : analysis.supplier.counterparty_id ? (
              <span className="tg-prihod-hit">{analysis.supplier.counterparty_name}</span>
            ) : (
              <span className="tg-prihod-miss">
                «{analysis.supplier.name}» — {analysis.supplier.suggestions?.length
                  ? `похоже: ${analysis.supplier.suggestions.slice(0, 2).map((s) => s.name).join(', ')}`
                  : 'не найден'}
              </span>
            )}
          </div>
          {analysis.lines.map((line) => (
            <div key={line.index} className="tg-prihod-parsed-row">
              <span>{line.name}</span>
              {' → '}
              {line.product_id ? (
                <span className="tg-prihod-hit">{line.product_label}</span>
              ) : (
                <span className="tg-prihod-miss">
                  {line.suggestions?.length
                    ? `похоже: ${line.suggestions.slice(0, 2).map((s) => s.label).join(', ')}`
                    : 'не найден'}
                </span>
              )}
              <span className="muted">
                {' · '}{formatQty(line.quantity)} {line.product_unit || line.parsed_unit || ''}
                {line.pieces ? ` (${line.pieces} шт)` : ''}
              </span>
            </div>
          ))}
          {entry.error && <div className="tg-prihod-miss">{entry.error}</div>}
        </div>
      </div>

      <div className="tg-prihod-card-actions">
        {pending && (
          <>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onReview(entry)}>
              Разобрать и создать
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onStatus(entry, 'ignored')}>
              Пропустить
            </button>
          </>
        )}
        {entry.status === 'created' && entry.document_id && (
          <a className="btn btn-ghost btn-sm" href={`/prihod?open=${entry.document_id}`} target="_blank" rel="noreferrer">
            Открыть приход ↗
          </a>
        )}
        {entry.status === 'ignored' && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onStatus(entry, 'new')}>
            Вернуть
          </button>
        )}
      </div>
    </div>
  );
}

function ReviewModal({ entry, products, suppliers, departments, canConfirm, onClose, onDone, show }) {
  const productPrice = useCallback((productId, variantId) => {
    const resolved = resolvePickFromProducts(products, encodeProductPick(productId, variantId));
    return Number(resolved.product?.last_price) || 0;
  }, [products]);

  const [form, setForm] = useState(() => ({
    date: entry.doc_date,
    department_id: entry.department_id || departments[0]?.id || '',
    counterparty_id: entry.analysis.supplier?.counterparty_id || '',
    remember: true,
    lines: entry.analysis.lines.map((line) => ({
      ...line,
      quantity: line.quantity,
      price: line.price || (line.product_id ? productPrice(line.product_id, line.variant_id) : 0),
    })),
  }));
  const [saving, setSaving] = useState(false);

  const updateLine = (idx, patch) => {
    setForm((f) => ({ ...f, lines: f.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)) }));
  };

  const pickProduct = (idx, pick) => {
    const resolved = resolvePickFromProducts(products, pick);
    const line = form.lines[idx];
    updateLine(idx, {
      product_id: resolved.productId || null,
      variant_id: resolved.variantId || null,
      product_unit: resolved.product?.unit || null,
      price: line.price || (resolved.productId ? productPrice(resolved.productId, resolved.variantId) : 0),
    });
  };

  const total = useMemo(
    () => form.lines.reduce((s, l) => s + (l.product_id ? (parseQtyInput(l.quantity) || 0) * (Number(l.price) || 0) : 0), 0),
    [form.lines],
  );

  const submit = async (confirm) => {
    if (!form.counterparty_id) {
      show('Выберите поставщика', 'error');
      return;
    }
    const items = form.lines
      .filter((l) => l.product_id)
      .map((l) => ({
        line_index: l.index,
        product_id: l.product_id,
        variant_id: l.variant_id || null,
        quantity: parseQtyInput(l.quantity),
        price: Number(l.price) || 0,
      }));
    if (!items.length) {
      show('Выберите товары', 'error');
      return;
    }
    if (items.some((i) => !(i.quantity > 0))) {
      show('Проверьте количество', 'error');
      return;
    }
    if (items.length < form.lines.length && !window.confirm('Не все строки сопоставлены — создать приход без них?')) return;
    setSaving(true);
    try {
      const result = await api.createTelegramPrihod(entry.id, {
        date: form.date,
        department_id: form.department_id,
        counterparty_id: form.counterparty_id,
        remember: form.remember,
        confirm,
        items,
      });
      if (result.confirm_error) show(`Приход создан, но не проведён: ${result.confirm_error}`, 'error');
      else show(result.confirmed ? `Приход №${result.document.number} проведён` : `Создан приход №${result.document.number}`);
      onDone();
    } catch (e) {
      show(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const supplierHint = entry.analysis.supplier;

  return (
    <Modal
      title="Приход из сообщения"
      wide
      onClose={onClose}
      footer={(
        <>
          <ModalCancelButton />
          <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => submit(false)}>
            Создать черновик
          </button>
          {canConfirm && (
            <button type="button" className="btn btn-primary" disabled={saving} onClick={() => submit(true)}>
              Создать и провести
            </button>
          )}
        </>
      )}
    >
      <div className="tg-prihod-review">
        <div className="tg-prihod-review-source">
          <div className="muted">
            {entry.from_name || 'Сообщение'} · {formatDate(entry.doc_date)} {messageTime(entry.message_at)}
          </div>
          <pre className="tg-prihod-text">{entry.text}</pre>
        </div>

        <div className="form-grid tg-prihod-review-head">
          <label>
            Дата
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </label>
          <label>
            Отдел (склад)
            <select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label style={{ gridColumn: 'span 2' }}>
            Поставщик{supplierHint ? ` (в сообщении: «${supplierHint.name}»)` : ''}
            <CounterpartySearchSelect
              items={suppliers}
              value={form.counterparty_id}
              onChange={(id) => setForm({ ...form, counterparty_id: id || '' })}
              placeholder="Найти поставщика…"
            />
            {!form.counterparty_id && supplierHint?.suggestions?.length > 0 && (
              <span className="tg-prihod-suggest">
                {supplierHint.suggestions.map((s) => (
                  <button key={s.id} type="button" className="tg-prihod-chip" onClick={() => setForm({ ...form, counterparty_id: s.id })}>
                    {s.name}
                  </button>
                ))}
              </span>
            )}
          </label>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: '22%' }}>Из сообщения</th>
                <th>Товар</th>
                <th style={{ width: 110 }}>Кол-во</th>
                <th style={{ width: 130 }}>Цена</th>
                <th style={{ width: 130 }}>Сумма</th>
              </tr>
            </thead>
            <tbody>
              {form.lines.map((line, idx) => {
                const qty = parseQtyInput(line.quantity) || 0;
                return (
                  <tr key={line.index}>
                    <td>
                      <div>{line.name}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {formatQty(line.parsed_quantity)} {line.parsed_unit || ''}
                        {line.pieces ? ` · ${line.pieces} шт` : ''}
                      </div>
                    </td>
                    <td>
                      <ProductSelect
                        products={products}
                        value={encodeProductPick(line.product_id, line.variant_id)}
                        onChange={(v) => pickProduct(idx, v)}
                      />
                      {!line.product_id && line.suggestions?.length > 0 && (
                        <span className="tg-prihod-suggest">
                          {line.suggestions.map((s) => (
                            <button
                              key={`${s.product_id}:${s.variant_id || ''}`}
                              type="button"
                              className="tg-prihod-chip"
                              onClick={() => pickProduct(idx, encodeProductPick(s.product_id, s.variant_id))}
                            >
                              {s.label}
                            </button>
                          ))}
                        </span>
                      )}
                    </td>
                    <td>
                      <input
                        value={String(line.quantity ?? '').replace('.', ',')}
                        inputMode="decimal"
                        onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                      />
                      <div className="muted" style={{ fontSize: 12 }}>{line.product_unit || ''}</div>
                    </td>
                    <td>
                      <input
                        className="input-money"
                        value={formatPriceInput(line.price)}
                        onChange={(e) => updateLine(idx, { price: parsePriceInput(e.target.value) ?? 0 })}
                      />
                    </td>
                    <td>{line.product_id ? formatMoney(qty * (Number(line.price) || 0)) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="tg-prihod-review-foot">
          <label className="checkbox-inline">
            <input
              type="checkbox"
              checked={form.remember}
              onChange={(e) => setForm({ ...form, remember: e.target.checked })}
            />
            Запомнить сопоставления (в следующий раз приход создастся сам)
          </label>
          <strong>Итого: {formatMoney(total)}</strong>
        </div>
      </div>
    </Modal>
  );
}

function PasteModal({ departments, onClose, onDone, show }) {
  const [text, setText] = useState('');
  const [departmentId, setDepartmentId] = useState(departments[0]?.id || '');
  const [date, setDate] = useState(todayLocalIso());
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!text.trim()) {
      show('Вставьте текст сообщений', 'error');
      return;
    }
    setSaving(true);
    try {
      const r = await api.importTelegramPrihodText({ text, department_id: departmentId, date });
      show(`Добавлено: ${r.added}${r.duplicates ? `, уже были: ${r.duplicates}` : ''}${r.skipped ? `, без товаров: ${r.skipped}` : ''}`);
      onDone();
    } catch (e) {
      show(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Вставить сообщения из Telegram"
      wide
      onClose={onClose}
      dirty={!!text.trim()}
      footer={(
        <>
          <ModalCancelButton />
          <button type="button" className="btn btn-primary" disabled={saving} onClick={submit}>Загрузить</button>
        </>
      )}
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Для сообщений, написанных до подключения бота: выделите сообщения в Telegram Desktop → «Копировать» и вставьте сюда.
        Дата и автор берутся из строк вида «Нодирбек, [09.10.2026 8:39]». Повторная вставка не создаёт дублей.
      </p>
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <label>
          Отдел (склад)
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label>
          Дата, если в тексте её нет
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <textarea
        rows={14}
        style={{ width: '100%', fontFamily: 'inherit' }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'Нодирбек, [09.10.2026 8:39]\nЖалилдан:\nСон-19,8кг\nЛента-13кг'}
      />
    </Modal>
  );
}

function TopicsPanel({ topics, departments, canEdit, onChanged, show }) {
  const save = async (topic, patch) => {
    const next = { ...topic, ...patch };
    if (next.mode === 'prihod' && !next.department_id) next.department_id = departments[0]?.id || '';
    try {
      await api.updateTelegramPrihodTopic(topic.id, {
        mode: next.mode,
        department_id: next.department_id,
        auto_create: next.auto_create,
        auto_confirm: next.auto_confirm,
        notify: next.notify,
      });
      onChanged();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  return (
    <>
      <div className="card">
        <div className="card-header"><strong>Как подключить группу с темами</strong></div>
        <div className="card-body" style={{ fontSize: 14 }}>
          <ol style={{ paddingLeft: 20, lineHeight: 1.8, margin: 0 }}>
            <li>Добавьте бота в группу и сделайте его <strong>администратором</strong> (или в @BotFather: <code>/setprivacy</code> → Disable) — иначе бот не видит обычные сообщения.</li>
            <li>Напишите в нужной теме (например «Приход гушт») любое сообщение или <code>/topic</code> — тема появится в списке ниже.</li>
            <li>Включите режим «Приход» и выберите склад (отдел), куда приходовать.</li>
            <li>Зав. склад пишет как обычно: «Жалилдан:» и строки «Сон-45,8кг». Если поставщик и товары узнаны — бот сам создаёт приход и отвечает в теме; иначе сообщение ждёт во вкладке «Входящие».</li>
          </ol>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Группа / тема</th>
                <th>Режим</th>
                <th>Склад</th>
                <th title="Создавать приход сразу, если всё распознано">Автосоздание</th>
                <th title="Проводить сразу, если найдены все цены">Автопроведение</th>
                <th title="Бот отвечает в теме">Ответ в теме</th>
              </tr>
            </thead>
            <tbody>
              {topics.map((t) => (
                <tr key={t.id}>
                  <td>
                    <div><strong>{t.title || (t.thread_id ? `Тема #${t.thread_id}` : 'Общий чат')}</strong></div>
                    <div className="muted" style={{ fontSize: 12 }}>{t.chat_title || t.chat_id}</div>
                  </td>
                  <td>
                    <select value={t.mode} disabled={!canEdit} onChange={(e) => save(t, { mode: e.target.value })}>
                      <option value="off">Выключено</option>
                      <option value="prihod">Приход</option>
                    </select>
                  </td>
                  <td>
                    <select
                      value={t.department_id || ''}
                      disabled={!canEdit || t.mode !== 'prihod'}
                      onChange={(e) => save(t, { department_id: e.target.value })}
                    >
                      {t.mode !== 'prihod' && <option value="">—</option>}
                      {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </td>
                  {['auto_create', 'auto_confirm', 'notify'].map((key) => (
                    <td key={key} style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={!!t[key]}
                        disabled={!canEdit || t.mode !== 'prihod'}
                        onChange={(e) => save(t, { [key]: e.target.checked })}
                      />
                    </td>
                  ))}
                </tr>
              ))}
              {topics.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty">
                    Бот ещё не видел ни одной группы. Добавьте его в группу и напишите в теме <code>/topic</code>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export default function TelegramPrihod() {
  const { user } = useAuth();
  const { branchId } = useBranch();
  const { show, Toast } = useToast();
  const canConfirm = hasPermission(user, 'documents.confirm');
  const canEditTopics = hasPermission(user, 'telegram.settings');

  const [tab, setTab] = useState('inbox');
  const [status, setStatus] = useState('pending');
  const [inbox, setInbox] = useState({ items: [], counts: {} });
  const [topics, setTopics] = useState([]);
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [review, setReview] = useState(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const loadInbox = useCallback(async () => {
    try {
      setInbox(await api.getTelegramPrihodInbox({ status }));
    } catch (e) {
      show(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [status, show]);

  const loadTopics = useCallback(async () => {
    try {
      setTopics(await api.getTelegramPrihodTopics());
    } catch (e) {
      show(e.message, 'error');
    }
  }, [show]);

  useEffect(() => { loadInbox(); }, [loadInbox, branchId]);
  useEffect(() => { loadTopics(); }, [loadTopics, branchId]);

  useEffect(() => {
    Promise.all([
      api.getProducts({ limit: 5000, last_doc_type: 'prihod' }),
      api.getCounterparties('supplier'),
      api.getDepartments(),
    ]).then(([prods, cps, deps]) => {
      setProducts(Array.isArray(prods) ? prods : (prods?.items || []));
      setSuppliers(Array.isArray(cps) ? cps : []);
      setDepartments((Array.isArray(deps) ? deps : []).filter((d) => d.active !== 0 && d.active !== false));
    }).catch((e) => show(e.message, 'error'));
  }, [show, branchId]);

  const readyIds = useMemo(
    () => inbox.items.filter((i) => (i.status === 'new' || i.status === 'error') && i.analysis?.ready).map((i) => i.id),
    [inbox.items],
  );
  const pendingCount = (inbox.counts.new || 0) + (inbox.counts.error || 0);

  const setEntryStatus = async (entry, next) => {
    try {
      await api.setTelegramPrihodStatus(entry.id, next);
      loadInbox();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const createReady = async () => {
    if (!readyIds.length) return;
    if (!window.confirm(`Создать черновики приходов по ${readyIds.length} распознанным сообщениям?`)) return;
    setBulkBusy(true);
    try {
      const r = await api.createReadyTelegramPrihods(readyIds);
      show(`Создано приходов: ${r.created.length}${r.skipped ? `, пропущено: ${r.skipped}` : ''}`);
      loadInbox();
    } catch (e) {
      show(e.message, 'error');
    } finally {
      setBulkBusy(false);
    }
  };

  const activeTopics = topics.filter((t) => t.mode === 'prihod').length;

  return (
    <div className="page">
      {Toast}
      <div className="page-header">
        <div>
          <h1>Приходы из Telegram</h1>
          <p className="muted">
            Зав. склад пишет приход в теме группы — система создаёт документ «Приход».
            {activeTopics === 0 && ' Подключите тему на вкладке «Темы».'}
          </p>
        </div>
        <div className="btn-group">
          <button type="button" className="btn btn-ghost" onClick={() => setPasteOpen(true)} disabled={!departments.length}>
            Вставить из Telegram
          </button>
          {tab === 'inbox' && readyIds.length > 0 && (
            <button type="button" className="btn btn-primary" onClick={createReady} disabled={bulkBusy}>
              Создать готовые ({readyIds.length})
            </button>
          )}
        </div>
      </div>

      <div className="tg-prihod-tabs">
        <button type="button" className={`section-tab${tab === 'inbox' ? ' is-active' : ''}`} onClick={() => setTab('inbox')}>
          Входящие{pendingCount ? ` (${pendingCount})` : ''}
        </button>
        <button type="button" className={`section-tab${tab === 'topics' ? ' is-active' : ''}`} onClick={() => setTab('topics')}>
          Темы{activeTopics ? ` (${activeTopics})` : ''}
        </button>
      </div>

      {tab === 'topics' ? (
        <TopicsPanel
          topics={topics}
          departments={departments}
          canEdit={canEditTopics}
          onChanged={loadTopics}
          show={show}
        />
      ) : (
        <>
          <div className="tg-prihod-filters">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.id || 'all'}
                type="button"
                className={`tg-prihod-chip${status === f.id ? ' is-active' : ''}`}
                onClick={() => setStatus(f.id)}
              >
                {f.label}
                {f.id === 'pending' && pendingCount ? ` (${pendingCount})` : ''}
                {f.id === 'created' && inbox.counts.created ? ` (${inbox.counts.created})` : ''}
              </button>
            ))}
          </div>
          {loading ? (
            <p className="muted">Загрузка…</p>
          ) : inbox.items.length === 0 ? (
            <div className="card"><div className="card-body muted">Сообщений нет.</div></div>
          ) : (
            <div className="tg-prihod-list">
              {inbox.items.map((entry) => (
                <EntryCard key={entry.id} entry={entry} onReview={setReview} onStatus={setEntryStatus} />
              ))}
            </div>
          )}
        </>
      )}

      {review && (
        <ReviewModal
          entry={review}
          products={products}
          suppliers={suppliers}
          departments={departments}
          canConfirm={canConfirm}
          show={show}
          onClose={() => setReview(null)}
          onDone={() => { setReview(null); loadInbox(); }}
        />
      )}
      {pasteOpen && (
        <PasteModal
          departments={departments}
          show={show}
          onClose={() => setPasteOpen(false)}
          onDone={() => { setPasteOpen(false); setStatus('pending'); loadInbox(); }}
        />
      )}
    </div>
  );
}
