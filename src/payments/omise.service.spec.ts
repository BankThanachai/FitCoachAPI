import Omise from 'omise';
import { OmiseService } from './omise.service';

jest.mock('omise');

const mockChargesCreate = jest.fn();

describe('OmiseService.chargeFromSource', () => {
  beforeAll(() => {
    process.env.OMISE_SECRET_KEY = 'skey_test_x';
    process.env.OMISE_PUBLIC_KEY = 'pkey_test_x';
    (Omise as unknown as jest.Mock).mockReturnValue({
      charges: { create: mockChargesCreate, retrieve: jest.fn() },
      sources: { create: jest.fn() },
    });
  });

  it("sets a short expires_at instead of relying on Omise's 24h default", async () => {
    mockChargesCreate.mockResolvedValue({
      id: 'chrg_test_1',
      status: 'pending',
    });
    const service = new OmiseService();

    const before = Date.now();
    await service.chargeFromSource(100, 'src_test_1');
    const after = Date.now();

    expect(mockChargesCreate).toHaveBeenCalledTimes(1);
    const calls = mockChargesCreate.mock.calls as Array<
      [{ expires_at: string }]
    >;
    const callArgs = calls[0][0];
    expect(callArgs.expires_at).toBeDefined();

    const expiresAtMs = new Date(callArgs.expires_at).getTime();
    const fifteenMinutesMs = 15 * 60_000;
    // Allow slack for test execution time either side of "now".
    expect(expiresAtMs).toBeGreaterThanOrEqual(
      before + fifteenMinutesMs - 5_000,
    );
    expect(expiresAtMs).toBeLessThanOrEqual(after + fifteenMinutesMs + 5_000);
  });
});
