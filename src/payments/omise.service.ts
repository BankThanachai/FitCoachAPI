import { Injectable } from '@nestjs/common';
import Omise, { Charges, Sources } from 'omise';
import type { Prisma } from '../../generated/prisma/client';
import { omiseConfig } from './omise.config';

const CURRENCY = 'thb';

function toSatang(amountBaht: number | Prisma.Decimal): number {
  return Math.round(Number(amountBaht) * 100);
}

@Injectable()
export class OmiseService {
  private readonly client: Omise.IOmise;

  constructor() {
    this.client = Omise({
      publicKey: omiseConfig.publicKey,
      secretKey: omiseConfig.secretKey,
    });
  }

  chargeWithToken(
    amountBaht: number | Prisma.Decimal,
    token: string,
  ): Promise<Charges.ICharge> {
    return this.client.charges.create({
      amount: toSatang(amountBaht),
      currency: CURRENCY,
      card: token,
    });
  }

  createPromptPaySource(
    amountBaht: number | Prisma.Decimal,
  ): Promise<Sources.ISource> {
    return this.client.sources.create({
      type: 'promptpay',
      amount: toSatang(amountBaht),
      currency: CURRENCY,
    });
  }

  chargeFromSource(
    amountBaht: number | Prisma.Decimal,
    sourceId: string,
  ): Promise<Charges.ICharge> {
    return this.client.charges.create({
      amount: toSatang(amountBaht),
      currency: CURRENCY,
      source: sourceId,
    });
  }

  retrieveCharge(chargeId: string): Promise<Charges.ICharge> {
    return this.client.charges.retrieve(chargeId);
  }
}
