import { v4 as uuidv4 } from 'uuid';
import db from './db.js';
import { DEFAULT_BRANCH_ID } from './branches.js';

const { queryAll, queryOne, run } = db;

import {
  LEGACY_ARTICLE_CODES,
  DEFAULT_CASH_ARTICLES,
  PURCHASE_ARTICLE_CODE,
  cashArticleId,
} from './cashArticleDefaults.js';

export function isPurchaseArticle(article) {
  if (!article) return false;
  if (article.code === PURCHASE_ARTICLE_CODE) return true;
  return article.id === 'ca_exp_purchase' || (typeof article.id === 'string' && article.id.endsWith(`__${PURCHASE_ARTICLE_CODE}`));
}

export function isPurchaseArticleId(articleId) {
  if (!articleId) return false;
  if (articleId === 'ca_exp_purchase') return true;
  return articleId.endsWith(`__${PURCHASE_ARTICLE_CODE}`);
}

export function seedCashArticlesForBranch(branchId = DEFAULT_BRANCH_ID) {
  for (const article of DEFAULT_CASH_ARTICLES) {
    const id = cashArticleId(branchId, article.code);
    run(
      `INSERT OR IGNORE INTO cash_articles
        (id, name, direction, sort_order, active, branch_id, code)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
      [id, article.name, article.direction, article.sort_order, branchId, article.code],
    );
  }
}

export { PURCHASE_ARTICLE_CODE, cashArticleId } from './cashArticleDefaults.js';

function assertBranchArticle(article, branchId) {
  const articleBranch = article.branch_id || DEFAULT_BRANCH_ID;
  if (branchId && articleBranch !== branchId) {
    throw new Error('Статья принадлежит другому филиалу');
  }
}

export function getCashArticles(direction = null, branchId = DEFAULT_BRANCH_ID) {
  let sql = `
    SELECT id, name, direction, sort_order, code, branch_id
    FROM cash_articles
    WHERE active = 1 AND branch_id = ?
  `;
  const params = [branchId];
  if (direction) {
    sql += ' AND direction = ?';
    params.push(direction);
  }
  sql += ' ORDER BY sort_order, name';
  return queryAll(sql, params);
}

export function getCashArticlesAll(branchId = DEFAULT_BRANCH_ID) {
  return queryAll(`
    SELECT ca.*,
      (SELECT COUNT(*) FROM payments p
       WHERE p.article_id = ca.id AND (p.branch_id = ca.branch_id OR (p.branch_id IS NULL AND ca.branch_id = 'main'))
      ) AS usage_count
    FROM cash_articles ca
    WHERE ca.branch_id = ?
    ORDER BY ca.direction, ca.sort_order, ca.name
  `, [branchId]);
}

export function getCashArticle(id, branchId = null) {
  if (branchId) {
    return queryOne('SELECT * FROM cash_articles WHERE id = ? AND branch_id = ?', [id, branchId]);
  }
  return queryOne('SELECT * FROM cash_articles WHERE id = ?', [id]);
}

export function createCashArticle(data, branchId = DEFAULT_BRANCH_ID) {
  const name = (data.name || '').trim();
  if (!name) throw new Error('Укажите название статьи');
  if (!['income', 'expense'].includes(data.direction)) {
    throw new Error('Укажите направление: приход или расход');
  }
  const id = data.id || `${branchId}__${uuidv4()}`;
  const sortOrder = Number.isFinite(Number(data.sort_order)) ? Number(data.sort_order) : 0;
  const active = data.active === false ? 0 : 1;
  run(
    `INSERT INTO cash_articles (id, name, direction, sort_order, active, branch_id, code)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    [id, name, data.direction, sortOrder, active, branchId],
  );
  return queryOne('SELECT *, 0 AS usage_count FROM cash_articles WHERE id = ?', [id]);
}

export function updateCashArticle(id, data, branchId = DEFAULT_BRANCH_ID) {
  const existing = getCashArticle(id, branchId);
  if (!existing) throw new Error('Статья не найдена');

  const name = data.name !== undefined ? String(data.name).trim() : existing.name;
  if (!name) throw new Error('Укажите название статьи');

  let direction = data.direction ?? existing.direction;
  if (existing.code === PURCHASE_ARTICLE_CODE && direction !== 'expense') {
    throw new Error('Статья «Закуп» должна оставаться расходом');
  }
  if (!['income', 'expense'].includes(direction)) {
    throw new Error('Неверное направление');
  }

  const sortOrder = data.sort_order !== undefined
    ? Number(data.sort_order)
    : existing.sort_order;
  const active = data.active !== undefined ? (data.active ? 1 : 0) : existing.active;

  if (existing.code === PURCHASE_ARTICLE_CODE && !active) {
    throw new Error('Статью «Закуп» нельзя отключить');
  }

  run(
    'UPDATE cash_articles SET name = ?, direction = ?, sort_order = ?, active = ? WHERE id = ? AND branch_id = ?',
    [name, direction, sortOrder, active, id, branchId],
  );

  return queryOne(`
    SELECT ca.*,
      (SELECT COUNT(*) FROM payments p
       WHERE p.article_id = ca.id AND (p.branch_id = ca.branch_id OR (p.branch_id IS NULL AND ca.branch_id = 'main'))
      ) AS usage_count
    FROM cash_articles ca
    WHERE ca.id = ? AND ca.branch_id = ?
  `, [id, branchId]);
}

export function deleteCashArticle(id, branchId = DEFAULT_BRANCH_ID) {
  const existing = getCashArticle(id, branchId);
  if (!existing) throw new Error('Статья не найдена');
  if (existing.code === PURCHASE_ARTICLE_CODE) {
    throw new Error('Системную статью «Закуп» нельзя удалить');
  }

  const usage = queryOne(
    `SELECT COUNT(*) AS c FROM payments
     WHERE article_id = ? AND (branch_id = ? OR (branch_id IS NULL AND ? = 'main'))`,
    [id, branchId, branchId],
  ).c;
  if (usage > 0) {
    run('UPDATE cash_articles SET active = 0 WHERE id = ? AND branch_id = ?', [id, branchId]);
    return { deactivated: true };
  }

  run('DELETE FROM cash_articles WHERE id = ? AND branch_id = ?', [id, branchId]);
  return { deactivated: false };
}

export function assertCashArticleForPayment(articleId, paymentType, branchId = DEFAULT_BRANCH_ID) {
  if (!articleId) return null;
  const article = getCashArticle(articleId, branchId);
  if (!article || !article.active) throw new Error('Статья не найдена');
  assertBranchArticle(article, branchId);
  const isIncome = paymentType === 'other_income' || paymentType === 'customer_income';
  if (isIncome && article.direction !== 'income') throw new Error('Статья не подходит для прихода');
  if (!isIncome && article.direction !== 'expense') throw new Error('Статья не подходит для расхода');
  return article;
}
