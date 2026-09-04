/** Rounds an average score (e.g. from a Prisma _avg aggregate) to 2 decimal places, treating null/0 as 0. */
export function roundScore(score: number | null): number {
  return score ? Math.round(score * 100) / 100 : 0;
}
