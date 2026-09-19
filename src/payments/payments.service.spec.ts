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
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      delete: jest.Mock;
    };
    purchaseCoupon: { findMany: jest.Mock };
    coupon: { updateMany: jest.Mock };
    coursePurchase: { findUniqueOrThrow: jest.Mock; delete: jest.Mock };
    paymentEvent: { findUnique: jest.Mock; create: jest.Mock };
    $transaction: jest.Mock;
  };
  let omiseService: { retrieveCharge: jest.Mock };

  // Fake Prisma.TransactionClient — routes to the same mocked table methods
  // as the top-level prisma mock, since $transaction just executes its
  // callback with a tx that (for these tests) behaves the same way.
  let fakeTx: typeof prisma;

  function makePurchase(
    overrides: Partial<{ workoutCount: number; hasReview: boolean }> = {},
  ) {
    return {
      id: PURCHASE_ID,
      clientId: CLIENT_ID,
      courseId: 'course-1',
      purchasedAt: new Date(),
      _count: { workouts: overrides.workoutCount ?? 0 },
      review: overrides.hasReview ? { id: 'review-1' } : null,
    };
  }

  beforeEach(async () => {
    prisma = {
      payment: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
      },
      purchaseCoupon: { findMany: jest.fn().mockResolvedValue([]) },
      coupon: { updateMany: jest.fn() },
      coursePurchase: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(makePurchase()),
        delete: jest.fn(),
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
    it('re-derives qrCodeUrl/expiresAt from Omise when still Pending', async () => {
      const payment = makePayment({ status: PaymentStatus.Pending });
      prisma.payment.findUnique.mockResolvedValue(payment);
      omiseService.retrieveCharge.mockResolvedValue({
        id: CHARGE_ID,
        status: 'pending',
        expires_at: '2026-09-19T12:15:00Z',
        source: {
          scannable_code: {
            image: { download_uri: 'https://example.com/qr.png' },
          },
        },
      });

      const result = await service.getStatus(CHARGE_ID, CLIENT_ID);

      expect(result.status).toBe(PaymentStatus.Pending);
      expect(result).toMatchObject({
        qrCodeUrl: 'https://example.com/qr.png',
        expiresAt: '2026-09-19T12:15:00Z',
      });
      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(prisma.coupon.updateMany).not.toHaveBeenCalled();
    });

    it('omits qrCodeUrl/expiresAt and does not release coupons once Successful', async () => {
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
      expect(result).not.toHaveProperty('qrCodeUrl');
      expect(result).not.toHaveProperty('expiresAt');
      expect(prisma.coupon.updateMany).not.toHaveBeenCalled();
    });

    it('releases coupons tied to the purchase when the charge is confirmed Failed', async () => {
      const payment = makePayment({ status: PaymentStatus.Pending });
      prisma.payment.findUnique.mockResolvedValue(payment);
      omiseService.retrieveCharge.mockResolvedValue({
        id: CHARGE_ID,
        status: 'failed',
        failure_code: 'insufficient_fund',
      });
      prisma.payment.update.mockResolvedValue({
        ...payment,
        status: PaymentStatus.Failed,
      });
      prisma.purchaseCoupon.findMany.mockResolvedValue([
        { couponId: 'coupon-1' },
      ]);

      const result = await service.getStatus(CHARGE_ID, CLIENT_ID);

      expect(result.status).toBe(PaymentStatus.Failed);
      expect(prisma.purchaseCoupon.findMany).toHaveBeenCalledWith({
        where: { purchaseId: PURCHASE_ID },
        select: { couponId: true },
      });
      expect(prisma.coupon.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['coupon-1'] } },
        data: { usedAt: null, usedTrainerId: null },
      });
    });

    it('does not call Omise again once already resolved (non-Pending) locally', async () => {
      const payment = makePayment({ status: PaymentStatus.Successful });
      prisma.payment.findUnique.mockResolvedValue(payment);

      const result = await service.getStatus(CHARGE_ID, CLIENT_ID);

      expect(omiseService.retrieveCharge).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.Successful);
      expect(result).not.toHaveProperty('qrCodeUrl');
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

    it('releases coupons when the verified charge is Expired', async () => {
      prisma.paymentEvent.findUnique.mockResolvedValue(null);
      prisma.payment.findUnique.mockResolvedValue(
        makePayment({ status: PaymentStatus.Pending }),
      );
      omiseService.retrieveCharge.mockResolvedValue({
        id: CHARGE_ID,
        status: 'expired',
      });
      prisma.purchaseCoupon.findMany.mockResolvedValue([
        { couponId: 'coupon-1' },
        { couponId: 'coupon-2' },
      ]);

      await service.handleWebhookEvent('charge.complete', makeWebhookPayload());

      const updateCalls = prisma.payment.update.mock.calls as Array<
        [{ data: { status: PaymentStatus } }]
      >;
      expect(updateCalls[0][0].data.status).toBe(PaymentStatus.Expired);
      expect(prisma.coupon.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['coupon-1', 'coupon-2'] } },
        data: { usedAt: null, usedTrainerId: null },
      });
    });

    it('does not release coupons when the verified charge is Successful', async () => {
      prisma.paymentEvent.findUnique.mockResolvedValue(null);
      prisma.payment.findUnique.mockResolvedValue(
        makePayment({ status: PaymentStatus.Pending }),
      );
      omiseService.retrieveCharge.mockResolvedValue({
        id: CHARGE_ID,
        status: 'successful',
      });

      await service.handleWebhookEvent('charge.complete', makeWebhookPayload());

      expect(prisma.coupon.updateMany).not.toHaveBeenCalled();
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

  describe('cancel', () => {
    it('deletes the Payment and CoursePurchase and releases coupons', async () => {
      const payment = makePayment({ status: PaymentStatus.Pending });
      prisma.payment.findUnique.mockResolvedValue(payment);
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      prisma.coursePurchase.findUniqueOrThrow.mockResolvedValue(makePurchase());
      prisma.purchaseCoupon.findMany.mockResolvedValue([
        { couponId: 'coupon-1' },
      ]);

      const result = await service.cancel(CHARGE_ID, CLIENT_ID);

      expect(result).toEqual({ deleted: true });
      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: payment.id, status: PaymentStatus.Pending },
        data: { status: PaymentStatus.Cancelled },
      });
      expect(prisma.coupon.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['coupon-1'] } },
        data: { usedAt: null, usedTrainerId: null },
      });
      expect(prisma.payment.delete).toHaveBeenCalledWith({
        where: { id: payment.id },
      });
      expect(prisma.coursePurchase.delete).toHaveBeenCalledWith({
        where: { id: PURCHASE_ID },
      });
      expect(omiseService.retrieveCharge).not.toHaveBeenCalled();
    });

    it('rejects cancelling a payment that already resolved (race-safe guard)', async () => {
      const payment = makePayment({ status: PaymentStatus.Pending });
      prisma.payment.findUnique.mockResolvedValue(payment);
      // Simulates a concurrent webhook having already flipped it to
      // Successful between the findUnique and the guarded updateMany.
      prisma.payment.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.cancel(CHARGE_ID, CLIENT_ID)).rejects.toThrow(
        'This payment can no longer be cancelled',
      );
      expect(prisma.coupon.updateMany).not.toHaveBeenCalled();
      expect(prisma.coursePurchase.delete).not.toHaveBeenCalled();
    });

    it('rejects cancelling an already-Successful payment', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        makePayment({ status: PaymentStatus.Successful }),
      );
      prisma.payment.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.cancel(CHARGE_ID, CLIENT_ID)).rejects.toThrow();
    });

    it('rejects a caller who does not own the payment', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        makePayment({ status: PaymentStatus.Pending }),
      );

      await expect(service.cancel(CHARGE_ID, 'someone-else')).rejects.toThrow();
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    });

    it('refuses to delete a purchase that already has a workout, instead of silently cascading', async () => {
      const payment = makePayment({ status: PaymentStatus.Pending });
      prisma.payment.findUnique.mockResolvedValue(payment);
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      prisma.coursePurchase.findUniqueOrThrow.mockResolvedValue(
        makePurchase({ workoutCount: 1 }),
      );

      await expect(service.cancel(CHARGE_ID, CLIENT_ID)).rejects.toThrow(
        'already has workouts or a review',
      );
      expect(prisma.coursePurchase.delete).not.toHaveBeenCalled();
      expect(prisma.payment.delete).not.toHaveBeenCalled();
    });

    it('refuses to delete a purchase that already has a review', async () => {
      const payment = makePayment({ status: PaymentStatus.Pending });
      prisma.payment.findUnique.mockResolvedValue(payment);
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      prisma.coursePurchase.findUniqueOrThrow.mockResolvedValue(
        makePurchase({ hasReview: true }),
      );

      await expect(service.cancel(CHARGE_ID, CLIENT_ID)).rejects.toThrow(
        'already has workouts or a review',
      );
      expect(prisma.coursePurchase.delete).not.toHaveBeenCalled();
    });

    it('deletes just the Payment when it has no linked purchase', async () => {
      const payment = {
        ...makePayment({ status: PaymentStatus.Pending }),
        purchaseId: null,
      };
      prisma.payment.findUnique.mockResolvedValue(payment);
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.cancel(CHARGE_ID, CLIENT_ID);

      expect(result).toEqual({ deleted: true });
      expect(prisma.payment.delete).toHaveBeenCalledWith({
        where: { id: payment.id },
      });
      expect(prisma.coursePurchase.delete).not.toHaveBeenCalled();
      expect(prisma.coupon.updateMany).not.toHaveBeenCalled();
    });
  });
});
