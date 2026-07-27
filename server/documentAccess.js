import { hasPermission, canAccessDocumentType } from './permissions.js';

export function filterDocumentsForUser(docs, role) {
  if (hasPermission(role, 'documents.view')) {
    return docs;
  }
  return docs.filter((d) => canAccessDocumentType(role, d.type));
}

export function assertDocumentTypeAccess(role, type) {
  if (!canAccessDocumentType(role, type)) {
    throw new Error('Недостаточно прав для этого типа документа');
  }
}

/**
 * Документ должен относиться к активному филиалу (филиал = отдельная фирма).
 * Перемещение видно на обоих концах (from/to). Админ тоже не обходит — только смена активного филиала.
 */
export function assertDocumentBranchAccess(user, doc, activeBranchId = null) {
  const branchId = activeBranchId || user?.branch_id;
  if (!branchId) throw new Error('Сотрудник не привязан к филиалу');
  const allowed = doc.branch_id === branchId
    || doc.from_branch_id === branchId
    || doc.to_branch_id === branchId;
  if (!allowed) throw new Error('Нет доступа к документу этого филиала');
}

/**
 * Изменять/проводить можно только «своим» филиалом.
 * Для перемещения — только отправитель (from), иначе чужая фирма трогает чужой склад.
 */
export function assertDocumentMutableInBranch(doc, activeBranchId) {
  if (!activeBranchId) throw new Error('Сотрудник не привязан к филиалу');
  if (doc.type === 'peremeshchenie') {
    const fromId = doc.from_branch_id || doc.branch_id;
    if (fromId !== activeBranchId) {
      throw new Error('Изменять перемещение может только филиал-отправитель');
    }
    return;
  }
  if (doc.branch_id !== activeBranchId) {
    throw new Error('Нет доступа к документу этого филиала');
  }
}

/** Контрагент без branch_id или чужого филиала недоступен. */
export function assertCounterpartyBranchAccess(user, counterparty, branchId) {
  if (!counterparty) throw new Error('Контрагент не найден');
  const cpBranch = counterparty.branch_id || null;
  if (!cpBranch || cpBranch !== branchId) {
    throw new Error('Нет доступа к контрагенту этого филиала');
  }
}
