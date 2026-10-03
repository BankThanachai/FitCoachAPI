import { Prisma } from '../../generated/prisma/client';
import { refreshTrainerRating } from './trainer-rating.util';

const TRAINER_ID = 'trainer-1';

function makeTx() {
  const calls: string[] = [];
  const tx = {
    $queryRaw: jest.fn((strings: TemplateStringsArray) => {
      calls.push(`lock:${strings.join('?').includes('FOR NO KEY UPDATE')}`);
      return Promise.resolve([]);
    }),
    review: { aggregate: jest.fn() },
    user: { update: jest.fn().mockResolvedValue({}) },
  };
  tx.review.aggregate.mockImplementation(() => {
    calls.push('aggregate');
    return Promise.resolve({ _avg: { score: 4 }, _count: 2 });
  });
  tx.user.update.mockImplementation(() => {
    calls.push('update');
    return Promise.resolve({});
  });
  return { tx: tx as unknown as Prisma.TransactionClient, mocks: tx, calls };
}

describe('refreshTrainerRating', () => {
  it('locks the row with FOR NO KEY UPDATE (not FOR UPDATE, which deadlocks with the FK lock of a concurrent review insert), then aggregates, then writes', async () => {
    const { tx, calls } = makeTx();

    await refreshTrainerRating(tx, TRAINER_ID);

    expect(calls).toEqual(['lock:true', 'aggregate', 'update']);
  });

  it('stores the average rounded to 2 places and the review count', async () => {
    const { tx, mocks } = makeTx();
    mocks.review.aggregate.mockResolvedValue({
      _avg: { score: 4.666666 },
      _count: 3,
    });

    await refreshTrainerRating(tx, TRAINER_ID);

    expect(mocks.review.aggregate).toHaveBeenCalledWith({
      where: { targetUserId: TRAINER_ID },
      _avg: { score: true },
      _count: true,
    });
    expect(mocks.user.update).toHaveBeenCalledWith({
      where: { id: TRAINER_ID },
      data: { rating: 4.67, reviewCount: 3 },
    });
  });

  it('resets to 0 / 0 when the trainer has no reviews left', async () => {
    const { tx, mocks } = makeTx();
    mocks.review.aggregate.mockResolvedValue({
      _avg: { score: null },
      _count: 0,
    });

    await refreshTrainerRating(tx, TRAINER_ID);

    expect(mocks.user.update).toHaveBeenCalledWith({
      where: { id: TRAINER_ID },
      data: { rating: 0, reviewCount: 0 },
    });
  });
});
