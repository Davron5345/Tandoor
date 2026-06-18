import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import Modal, { useToast } from '../components/Modal';
import { IconButton, IconArrowDown, IconArrowUp, IconEdit, IconPlus, IconTrash } from '../components/ActionIcons';
import { useAuth } from '../AuthContext';
import { hasPermission } from '../permissions';

const PURCHASE_ARTICLE_ID = 'ca_exp_purchase';

const emptyForm = {
  name: '',
  direction: 'expense',
  sort_order: 0,
  active: true,
};

function ArticleSection({
  title,
  direction,
  articles,
  canEdit,
  onAdd,
  onEdit,
  onRemove,
  onMove,
}) {
  const rows = useMemo(
    () => [...articles].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name, 'ru')),
    [articles],
  );

  return (
    <div className="card cash-articles-section">
      <div className="card-header">
        <strong>{title}</strong>
        {canEdit && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => onAdd(direction)}>
            <IconPlus /> Добавить
          </button>
        )}
      </div>
      <div className="table-wrap">
        <table className="cash-articles-table">
          <thead>
            <tr>
              <th className="col-order">№</th>
              <th>Название</th>
              <th className="col-status">Статус</th>
              <th className="col-usage">Использований</th>
              {canEdit && <th className="col-actions" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((article, index) => {
              const isSystem = article.id === PURCHASE_ARTICLE_ID;
              return (
                <tr key={article.id} className={!article.active ? 'cash-article-inactive' : ''}>
                  <td className="muted col-order">{article.sort_order ?? index + 1}</td>
                  <td>
                    {article.name}
                    {isSystem && <span className="badge badge-supplier cash-article-system">системная</span>}
                  </td>
                  <td className="col-status">
                    <span className={`badge badge-${article.active ? 'confirmed' : 'cancelled'}`}>
                      {article.active ? 'Активна' : 'Отключена'}
                    </span>
                  </td>
                  <td className="muted col-usage">{article.usage_count || 0}</td>
                  {canEdit && (
                    <td className="cash-articles-actions">
                      <div className="icon-toolbar">
                        <IconButton
                          className="btn-icon-move"
                          title="Выше"
                          disabled={index === 0}
                          onClick={() => onMove(article, -1)}
                        >
                          <IconArrowUp />
                        </IconButton>
                        <IconButton
                          className="btn-icon-move"
                          title="Ниже"
                          disabled={index === rows.length - 1}
                          onClick={() => onMove(article, 1)}
                        >
                          <IconArrowDown />
                        </IconButton>
                        <span className="icon-toolbar-sep" aria-hidden="true" />
                        <IconButton title="Изменить" onClick={() => onEdit(article)}>
                          <IconEdit />
                        </IconButton>
                        {!isSystem && (
                          <IconButton title="Удалить" danger onClick={() => onRemove(article)}>
                            <IconTrash />
                          </IconButton>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={canEdit ? 5 : 4} className="empty">Статей пока нет</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function CashArticles() {
  const [articles, setArticles] = useState([]);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const { show, Toast } = useToast();
  const { user } = useAuth();
  const canEdit = hasPermission(user, 'cash_articles.edit');

  const load = () => {
    api.getCashArticlesAll().then(setArticles).catch(console.error);
  };

  useEffect(() => { load(); }, []);

  const incomeArticles = useMemo(
    () => articles.filter((a) => a.direction === 'income'),
    [articles],
  );
  const expenseArticles = useMemo(
    () => articles.filter((a) => a.direction === 'expense'),
    [articles],
  );

  const openCreate = (direction) => {
    const list = direction === 'income' ? incomeArticles : expenseArticles;
    const maxSort = list.reduce((m, a) => Math.max(m, a.sort_order || 0), 0);
    setForm({ ...emptyForm, direction, sort_order: maxSort + 1, active: true });
    setModal('create');
  };

  const openEdit = (article) => {
    setForm({
      name: article.name,
      direction: article.direction,
      sort_order: article.sort_order || 0,
      active: !!article.active,
    });
    setModal(article.id);
  };

  const save = async () => {
    if (!form.name.trim()) {
      show('Укажите название', 'error');
      return;
    }
    try {
      const payload = {
        name: form.name.trim(),
        direction: form.direction,
        sort_order: Number(form.sort_order) || 0,
        active: form.active,
      };
      if (modal === 'create') {
        await api.createCashArticle(payload);
        show('Статья добавлена');
      } else {
        await api.updateCashArticle(modal, payload);
        show('Статья обновлена');
      }
      setModal(null);
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const remove = async (article) => {
    const msg = article.usage_count > 0
      ? `Статья «${article.name}» уже используется в операциях. Отключить её?`
      : `Удалить статью «${article.name}»?`;
    if (!window.confirm(msg)) return;
    try {
      const result = await api.deleteCashArticle(article.id);
      show(result.deactivated ? 'Статья отключена' : 'Статья удалена');
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const moveArticle = async (article, delta) => {
    const list = [...(article.direction === 'income' ? incomeArticles : expenseArticles)]
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name, 'ru'));
    const index = list.findIndex((a) => a.id === article.id);
    const swap = list[index + delta];
    if (!swap) return;
    try {
      await Promise.all([
        api.updateCashArticle(article.id, { sort_order: swap.sort_order }),
        api.updateCashArticle(swap.id, { sort_order: article.sort_order }),
      ]);
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const editingArticle = modal && modal !== 'create' ? articles.find((a) => a.id === modal) : null;
  const isSystemEdit = editingArticle?.id === PURCHASE_ARTICLE_ID;

  return (
    <div className="cash-articles-page">
      {Toast}

      <div className="page-header">
        <div>
          <h1>Статьи кассы</h1>
          <p className="page-subtitle-plain">Справочник статей прихода и расхода для страницы «Касса»</p>
        </div>
      </div>

      <ArticleSection
        title="Статьи прихода"
        direction="income"
        articles={incomeArticles}
        canEdit={canEdit}
        onAdd={openCreate}
        onEdit={openEdit}
        onRemove={remove}
        onMove={moveArticle}
      />

      <ArticleSection
        title="Статьи расхода"
        direction="expense"
        articles={expenseArticles}
        canEdit={canEdit}
        onAdd={openCreate}
        onEdit={openEdit}
        onRemove={remove}
        onMove={moveArticle}
      />

      <p className="cash-articles-note">
        Статья «Закуп» — системная: при выборе в кассе требуется указать поставщика. Её нельзя удалить или отключить.
      </p>

      {modal && (
        <Modal
          title={modal === 'create' ? 'Новая статья' : 'Редактировать статью'}
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>Отмена</button>
              <button type="button" className="btn btn-primary" onClick={save}>Сохранить</button>
            </>
          }
        >
          <div className="form-grid">
            <div className="form-group full">
              <label>Название *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Например: Транспорт"
              />
            </div>
            {modal === 'create' && (
              <div className="form-group">
                <label>Направление *</label>
                <select
                  value={form.direction}
                  onChange={(e) => setForm({ ...form, direction: e.target.value })}
                >
                  <option value="income">Приход</option>
                  <option value="expense">Расход</option>
                </select>
              </div>
            )}
            <div className="form-group">
              <label>Порядок</label>
              <input
                type="number"
                min="0"
                value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: +e.target.value })}
              />
            </div>
            {!isSystemEdit && (
              <div className="form-group">
                <label className="stock-filter-toggle">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => setForm({ ...form, active: e.target.checked })}
                  />
                  Активна (видна в кассе)
                </label>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
