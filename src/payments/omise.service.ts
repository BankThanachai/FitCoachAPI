import { Injectable } from '@nestjs/common';
import Omise, { Charges, Sources } from 'omise';
import type { Prisma } from '../../generated/prisma/client';
import { omiseConfig } from './omise.config';

const CURRENCY = 'thb';
// Omise defaults a PromptPay QR to a 24h expiry if `expires_at` isn't set on
// the charge — far longer than useful for a one-off in-app purchase. 15
// minutes matches typical PromptPay UX elsewhere. Omise caps this at 24h
// from charge creation; the countdown starts once the QR is generated.
const PROMPTPAY_EXPIRY_MINUTES = 15;

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
    const expiresAt = new Date(Date.now() + PROMPTPAY_EXPIRY_MINUTES * 60_000);
    return this.client.charges.create({
      amount: toSatang(amountBaht),
      currency: CURRENCY,
      source: sourceId,
      expires_at: expiresAt.toISOString(),
    });
  }

  retrieveCharge(chargeId: string): Promise<Charges.ICharge> {
    return this.client.charges.retrieve(chargeId);
  }
}
