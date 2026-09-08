export interface PaginatedResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Wraps a page of items into the app-wide pagination response shape. */
export function paginate<T>(
  data: T[],
  page: number,
  pageSize: number,
  total: number,
): PaginatedResult<T> {
  return {
    data,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}
