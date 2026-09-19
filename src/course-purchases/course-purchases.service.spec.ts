import { Test, TestingModule } from '@nestjs/testing';
import {
  PaymentMethod,
  PaymentStatus,
  Prisma,
  UserType,
} from '../../generated/prisma/client';
import { ClientTrainersService } from '../client-trainers/client-trainers.service';
import { CouponsService } from '../coupons/coupons.service';
import { OmiseService } from '../payments/omise.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { CoursePurchaseCalculationsService } from '../shared/course-purchase-calculations.service';
import { CoursePurchasesService } from './course-purchases.service';

const CLIENT_ID = 'client-1';
const COURSE_ID = 'course-1';
const TRAINER_ID = 'trainer-1';

describe('CoursePurchasesService.purchaseAndJoin', () => {
  let service: CoursePurchasesService;
  let prisma: {
    user: { findUnique: jest.Mock };
    trainerCourse: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let omiseService: {
    chargeWithToken: jest.Mock;
    createPromptPaySource: jest.Mock;
    chargeFromSource: jest.Mock;
    retrieveCharge: jest.Mock;
  };
  let paymentsService: { createInTransaction: jest.Mock };
  let clientTrainersService: {
    ensureAcceptedInTransaction: jest.Mock;
    notifyJoined: jest.Mock;
  };
  let couponsService: {
    validateCouponsForCourse: jest.Mock;
    redeem: jest.Mock;
  };

  // Fake Prisma.TransactionClient — only the calls purchaseAndJoin's
  // transaction body actually makes.
  const fakeTx = {
    coursePurchase: {
      create: jest.fn().mockResolvedValue({ id: 'purchase-1' }),
    },
  };

  function makeCourse(overrides: Partial<{ isTrial: boolean; price: number }>) {
    return {
      id: COURSE_ID,
      trainerId: TRAINER_ID,
      sessions: 1,
      isTrial: overrides.isTrial ?? false,
      price: new Prisma.Decimal(overrides.price ?? 500),
    };
  }

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: CLIENT_ID,
          type: UserType.Client,
        }),
      },
      trainerCourse: { findUnique: jest.fn() },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) =>
        Promise.resolve(cb(fakeTx)),
      ),
    };

    omiseService = {
      chargeWithToken: jest.fn(),
      createPromptPaySource: jest.fn(),
      chargeFromSource: jest.fn(),
      retrieveCharge: jest.fn(),
    };

    paymentsService = {
      createInTransaction: jest.fn().mockResolvedValue({ id: 'payment-1' }),
    };

    clientTrainersService = {
      ensureAcceptedInTransaction: jest.fn().mockResolvedValue({
        relation: { id: 'relation-1' },
        created: true,
      }),
      notifyJoined: jest.fn().mockResolvedValue(undefined),
    };

    couponsService = {
      validateCouponsForCourse: jest.fn().mockResolvedValue(undefined),
      redeem: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoursePurchasesService,
        { provide: PrismaService, useValue: prisma },
        { provide: CouponsService, useValue: couponsService },
        { provide: ClientTrainersService, useValue: clientTrainersService },
        { provide: PaymentsService, useValue: paymentsService },
        { provide: OmiseService, useValue: omiseService },
        {
          provide: CoursePurchaseCalculationsService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get(CoursePurchasesService);
  });

  describe('trial course (amount 0)', () => {
    it('commits directly without calling Omise when method is Card', async () => {
      prisma.trainerCourse.findUnique.mockResolvedValue(
        makeCourse({ isTrial: true, price: 0 }),
      );

      await service.purchaseAndJoin(CLIENT_ID, COURSE_ID, {
        couponIds: ['trial-coupon-1'],
        method: PaymentMethod.Card,
      });

      expect(omiseService.chargeWithToken).not.toHaveBeenCalled();
      expect(omiseService.createPromptPaySource).not.toHaveBeenCalled();
      expect(omiseService.chargeFromSource).not.toHaveBeenCalled();
      expect(paymentsService.createInTransaction).toHaveBeenCalledWith(
        fakeTx,
        CLIENT_ID,
        'purchase-1',
        expect.objectContaining({
          method: PaymentMethod.Card,
          amount: 0,
          status: PaymentStatus.Successful,
        }),
      );
    });

    it('commits directly without calling Omise when method is PromptPay', async () => {
      prisma.trainerCourse.findUnique.mockResolvedValue(
        makeCourse({ isTrial: true, price: 0 }),
      );

      await service.purchaseAndJoin(CLIENT_ID, COURSE_ID, {
        couponIds: ['trial-coupon-1'],
        method: PaymentMethod.PromptPay,
      });

      expect(omiseService.chargeWithToken).not.toHaveBeenCalled();
      expect(omiseService.createPromptPaySource).not.toHaveBeenCalled();
      expect(omiseService.chargeFromSource).not.toHaveBeenCalled();
      expect(paymentsService.createInTransaction).toHaveBeenCalledWith(
        fakeTx,
        CLIENT_ID,
        'purchase-1',
        expect.objectContaining({
          method: PaymentMethod.PromptPay,
          amount: 0,
          status: PaymentStatus.Successful,
        }),
      );
    });

    it('does not require an omiseToken even for method Card', async () => {
      prisma.trainerCourse.findUnique.mockResolvedValue(
        makeCourse({ isTrial: true, price: 0 }),
      );

      await expect(
        service.purchaseAndJoin(CLIENT_ID, COURSE_ID, {
          couponIds: ['trial-coupon-1'],
          method: PaymentMethod.Card,
          // omiseToken intentionally omitted
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('paid course (amount > 0)', () => {
    it('calls Omise chargeWithToken for Card and commits on success', async () => {
      prisma.trainerCourse.findUnique.mockResolvedValue(
        makeCourse({ isTrial: false, price: 500 }),
      );
      omiseService.chargeWithToken.mockResolvedValue({
        id: 'chrg_test_1',
        status: 'successful',
      });

      await service.purchaseAndJoin(CLIENT_ID, COURSE_ID, {
        method: PaymentMethod.Card,
        omiseToken: 'tokn_test_1',
      });

      expect(omiseService.chargeWithToken).toHaveBeenCalledWith(
        expect.any(Prisma.Decimal),
        'tokn_test_1',
      );
      expect(paymentsService.createInTransaction).toHaveBeenCalledWith(
        fakeTx,
        CLIENT_ID,
        'purchase-1',
        expect.objectContaining({
          method: PaymentMethod.Card,
          opnChargeId: 'chrg_test_1',
          status: PaymentStatus.Successful,
        }),
      );
    });

    it('throws and commits nothing when the Card charge fails', async () => {
      prisma.trainerCourse.findUnique.mockResolvedValue(
        makeCourse({ isTrial: false, price: 500 }),
      );
      omiseService.chargeWithToken.mockResolvedValue({
        id: 'chrg_test_2',
        status: 'failed',
        failure_code: 'insufficient_fund',
      });

      await expect(
        service.purchaseAndJoin(CLIENT_ID, COURSE_ID, {
          method: PaymentMethod.Card,
          omiseToken: 'tokn_test_2',
        }),
      ).rejects.toThrow();

      expect(paymentsService.createInTransaction).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('calls Omise source+charge for PromptPay and commits as Pending', async () => {
      prisma.trainerCourse.findUnique.mockResolvedValue(
        makeCourse({ isTrial: false, price: 500 }),
      );
      omiseService.createPromptPaySource.mockResolvedValue({
        id: 'src_test_1',
      });
      omiseService.chargeFromSource.mockResolvedValue({
        id: 'chrg_test_3',
        status: 'pending',
        expires_at: '2026-01-01T00:00:00Z',
        source: {
          scannable_code: {
            image: { download_uri: 'https://example.com/qr.png' },
          },
        },
      });

      const result = await service.purchaseAndJoin(CLIENT_ID, COURSE_ID, {
        method: PaymentMethod.PromptPay,
      });
      if (!('qrCodeUrl' in result)) {
        throw new Error('expected a qrCodeUrl in the PromptPay result');
      }

      expect(omiseService.createPromptPaySource).toHaveBeenCalled();
      expect(omiseService.chargeFromSource).toHaveBeenCalledWith(
        expect.any(Prisma.Decimal),
        'src_test_1',
      );
      expect(paymentsService.createInTransaction).toHaveBeenCalledWith(
        fakeTx,
        CLIENT_ID,
        'purchase-1',
        expect.objectContaining({
          method: PaymentMethod.PromptPay,
          opnChargeId: 'chrg_test_3',
          opnSourceId: 'src_test_1',
          status: PaymentStatus.Pending,
        }),
      );
      expect(result.qrCodeUrl).toBe('https://example.com/qr.png');
    });
  });
});
