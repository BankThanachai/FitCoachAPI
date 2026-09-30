import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from './sms-provider.interface';

// Dev/test default: no real SMS gateway is wired up yet, so the OTP is just
// logged where whoever is testing the flow can read it off. Never select
// this in production — see sms.config.ts.
@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger(ConsoleSmsProvider.name);

  sendOtpSms(to: string, code: string): Promise<void> {
    this.logger.log(`[DEV SMS] OTP for ${to}: ${code}`);
    return Promise.resolve();
  }
}
