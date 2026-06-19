import { hasPermission, canAccessDocumentType } from './permissions.js';

export function filterDocumentsForUser(docs, role) {
  if (
    hasPermission(role, 'documents.view')
    && hasPermission(role, 'documents.prihod')
    && hasPermission(role, 'documents.rashod')
  ) {
    return docs;
  }
  return docs.filter((d) => canAccessDocumentType(role, d.type));
}

export function assertDocumentTypeAccess(role, type) {
  if (!canAccessDocumentType(role, type)) {
    throw new Error('Недостаточно прав для этого типа документа');
  }
}

export function assertDocumentBranchAccess(user, doc) {
  if (user.role === 'admin') return;
  const branchId = user.branch_id;
  if (!branchId) throw new Error('Сотрудник не привязан к филиалу');
  const allowed = doc.branch_id === branchId
    || doc.from_branch_id === branchId
    || doc.to_branch_id === branchId;
  if (!allowed) throw new Error('Нет доступа к документу этого филиала');
}

export function assertCounterpartyBranchAccess(user, counterparty, branchId) {
  if (user.role === 'admin') return;
  if (counterparty?.branch_id && counterparty.branch_id !== branchId) {
    throw new Error('Нет доступа к контрагенту этого филиала');
  }
}
