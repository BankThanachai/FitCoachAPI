import { Test, TestingModule } from '@nestjs/testing';
import { PaymentMethod, PaymentStatus } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OmiseService } from './omise.service';
import { PaymentsService } from './payments.service';

const CLIENT_ID = 'client-1';
const CHARGE_ID = 'chrg_test_1';
const PURCHASE_ID = 'purchase-1';

function makePayment(overrides: Partial<{ status: PaymentStatus }> = {}) {
  return {
    id: 'payment-1',
    clientId: CLIENT_ID,
    purchaseId: PURCHASE_ID,
    opnChargeId: CHARGE_ID,
    opnSourceId: 'src_test_1',
    method: PaymentMethod.PromptPay,
    status: overrides.status ?? PaymentStatus.Pending,
    amount: 500,
    currency: 'THB',
    paidAt: null,
    failureCode: null,
    failureMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: {
    payment: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    paymentEvent: { findUnique: jest.Mock; create: jest.Mock };
    $transaction: jest.Mock;
  };
  let omiseService: { retrieveCharge: jest.Mock };

  // Fake Prisma.TransactionClient — routes to the same mocked table methods
  // as the top-level prisma mock, since $transaction just executes its
  // callback with a tx that (for these tests) behaves the same way.
  let fakeTx: typeof prisma;

  beforeEach(async () => {
    prisma = {
      payment: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      paymentEvent: { findUnique: jest.fn(), create: jest.fn() },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) =>
        Promise.resolve(cb(fakeTx)),
      ),
    };
    fakeTx = prisma;
    omiseService = { retrieveCharge: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: OmiseService, useValue: omiseService },
      ],
    }).compile();

    service = module.get(PaymentsService);
  });

  describe('getStatus', () => {
    it('reconciles against Omise and updates the status when still Pending', async () => {
      const payment = makePayment({ status: PaymentStatus.Pending });
      prisma.payment.findUnique.mockResolvedValue(payment);
      omiseService.retrieveCharge.mockResolvedValue({
        id: CHARGE_ID,
        status: 'successful',
      });
      prisma.payment.update.mockResolvedValue({
        ...payment,
        status: PaymentStatus.Successful,
        paidAt: new Date(),
      });

      const result = await service.getStatus(CHARGE_ID, CLIENT_ID);

      expect(result.status).toBe(PaymentStatus.Successful);
    });

    it('does not call Omise again once already resolved (non-Pending) locally', async () => {
      const payment = makePayment({ status: PaymentStatus.Successful });
      prisma.payment.findUnique.mockResolvedValue(payment);

      const result = await service.getStatus(CHARGE_ID, CLIENT_ID);

      expect(omiseService.retrieveCharge).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.Successful);
    });

    it('rejects a caller who does not own the payment', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        makePayment({ status: PaymentStatus.Pending }),
      );

      await expect(
        service.getStatus(CHARGE_ID, 'someone-else'),
      ).rejects.toThrow();
    });
  });

  describe('handleWebhookEvent', () => {
    function makeWebhookPayload() {
      return {
        id: 'evt_test_1',
        key: 'charge.complete',
        data: { id: CHARGE_ID },
      };
    }

    it('verifies against Omise before writing the status from a webhook', async () => {
      prisma.paymentEvent.findUnique.mockResolvedValue(null);
      prisma.payment.findUnique.mockResolvedValue(
        makePayment({ status: PaymentStatus.Pending }),
      );
      omiseService.retrieveCharge.mockResolvedValue({
        id: CHARGE_ID,
        status: 'successful',
      });

      await service.handleWebhookEvent('charge.complete', makeWebhookPayload());

      expect(omiseService.retrieveCharge).toHaveBeenCalledWith(CHARGE_ID);
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: PaymentStatus.Successful }),
        }),
      );
    });

    it('is idempotent — a duplicate event id short-circuits before touching Payment', async () => {
      prisma.paymentEvent.findUnique.mockResolvedValue({
        id: 'existing-event',
      });

      const result = await service.handleWebhookEvent(
        'charge.complete',
        makeWebhookPayload(),
      );

      expect(result).toEqual({ deduplicated: true, matched: false });
      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(omiseService.retrieveCharge).not.toHaveBeenCalled();
    });
  });
});
