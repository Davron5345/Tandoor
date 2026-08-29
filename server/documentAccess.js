import { hasPermission, canAccessDocumentType } from './permissions.js';

export function filterDocumentsForUser(docs, role) {
  if (hasPermission(role, 'documents.view')) {
    return docs;
  }
  return docs.filter((d) => canAccessDocumentType(role, d.type));
}

/** Сотрудник с привязкой к отделу — scoped для перемещений. */
export function isDepartmentScopedUser(user) {
  return Boolean(user?.department_id);
}

export function filterTransfersForDepartment(docs, user) {
  if (!isDepartmentScopedUser(user)) return docs;
  const deptId = user.department_id;
  return docs.filter((d) => {
    if (d.type !== 'peremeshchenie') return true;
    return d.from_department_id === deptId || d.to_department_id === deptId;
  });
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

/** Dept-scoped: перемещение только если отдел участвует. */
export function assertDocumentDepartmentAccess(user, doc) {
  if (!isDepartmentScopedUser(user) || doc.type !== 'peremeshchenie') return;
  const deptId = user.department_id;
  if (doc.from_department_id !== deptId && doc.to_department_id !== deptId) {
    throw new Error('Нет доступа к перемещению другого отдела');
  }
}

/**
 * Изменять/проводить можно только «своим» филиалом.
 * Для перемещения — только отправитель (from), иначе чужая фирма трогает чужой склад.
 * Dept-scoped: только если from_department_id = отдел пользователя.
 */
export function assertDocumentMutableInBranch(doc, activeBranchId, user = null) {
  if (!activeBranchId) throw new Error('Сотрудник не привязан к филиалу');
  if (doc.type === 'peremeshchenie') {
    const fromId = doc.from_branch_id || doc.branch_id;
    if (fromId !== activeBranchId) {
      throw new Error('Изменять перемещение может только филиал-отправитель');
    }
    if (isDepartmentScopedUser(user) && doc.from_department_id !== user.department_id) {
      throw new Error('Изменять перемещение может только отдел-отправитель');
    }
    return;
  }
  if (doc.branch_id !== activeBranchId) {
    throw new Error('Нет доступа к документу этого филиала');
  }
}

/** Принудительно from = отдел пользователя; только внутрифилиальное department-перемещение. */
export function applyDepartmentScopedTransferBody(body, user, branchId) {
  if (!isDepartmentScopedUser(user)) return body;
  if (body?.type !== 'peremeshchenie') return body;
  const next = { ...body, type: 'peremeshchenie' };
  next.from_department_id = user.department_id;
  next.from_branch_id = branchId;
  next.to_branch_id = branchId;
  next.branch_id = branchId;
  if (!next.to_department_id) {
    throw new Error('Выберите отдел назначения');
  }
  if (next.to_department_id === user.department_id) {
    throw new Error('Нельзя перемещать в свой же отдел');
  }
  return next;
}

/** Контрагент без branch_id или чужого филиала недоступен. */
export function assertCounterpartyBranchAccess(user, counterparty, branchId) {
  if (!counterparty) throw new Error('Контрагент не найден');
  const cpBranch = counterparty.branch_id || null;
  if (!cpBranch || cpBranch !== branchId) {
    throw new Error('Нет доступа к контрагенту этого филиала');
  }
}
