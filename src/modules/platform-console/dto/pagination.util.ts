export function normalizePagination(
  page: number,
  pageSize: number,
  defaultPageSize = 10,
  maxPageSize = 100,
): { page: number; pageSize: number; offset: number } {
  const safePage = Number.isFinite(page) ? Math.max(0, Math.trunc(page)) : 0;
  const rawSize = Number.isFinite(pageSize)
    ? Math.trunc(pageSize)
    : defaultPageSize;
  const safePageSize = Math.max(
    1,
    Math.min(maxPageSize, rawSize || defaultPageSize),
  );

  return {
    page: safePage,
    pageSize: safePageSize,
    offset: safePage * safePageSize,
  };
}

export function normalizeCursorPagination(
  cursor: number,
  limit: number,
  defaultLimit = 25,
  maxLimit = 100,
): { cursor: number; limit: number } {
  const safeCursor = Number.isFinite(cursor)
    ? Math.max(0, Math.trunc(cursor))
    : 0;
  const rawLimit = Number.isFinite(limit) ? Math.trunc(limit) : defaultLimit;
  const safeLimit = Math.max(1, Math.min(maxLimit, rawLimit || defaultLimit));

  return {
    cursor: safeCursor,
    limit: safeLimit,
  };
}
