export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

export function parsePagination(query = {}) {
  const hasPage = query.page !== undefined && query.page !== '';
  const hasLimit = query.limit !== undefined && query.limit !== '';
  if (!hasPage && !hasLimit) return null;

  const page = Math.max(1, parseInt(query.page, 10) || DEFAULT_PAGE);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(query.limit, 10) || DEFAULT_LIMIT),
  );

  return { page, limit, offset: (page - 1) * limit };
}

export function paginateList(items, pagination) {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / pagination.limit));
  const page = Math.min(pagination.page, pages);
  const offset = (page - 1) * pagination.limit;

  return {
    items: items.slice(offset, offset + pagination.limit),
    total,
    page,
    limit: pagination.limit,
    pages,
  };
}

export function buildPageResult(items, total, pagination) {
  const pages = Math.max(1, Math.ceil(total / pagination.limit));
  const page = Math.min(pagination.page, pages);

  return {
    items,
    total,
    page,
    limit: pagination.limit,
    pages,
  };
}

export function stripPaginationParams(query = {}) {
  const next = { ...query };
  delete next.page;
  delete next.limit;
  return next;
}
