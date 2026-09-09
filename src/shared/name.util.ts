/** Joins firstName/lastName into a single display name, or null if both are absent. */
export function computeFullName(
  firstName: string | null,
  lastName: string | null,
): string | null {
  const parts = [firstName, lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}

/** Adds a computed `name` (firstName + lastName) alongside the raw fields. */
export function withFullName<
  T extends { firstName: string | null; lastName: string | null },
>(entity: T): T & { name: string | null } {
  return { ...entity, name: computeFullName(entity.firstName, entity.lastName) };
}
