import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { resendConfig } from './resend.config';

@Injectable()
export class ResendService {
  private readonly client: Resend;
  private readonly logger = new Logger(ResendService.name);

  constructor() {
    this.client = new Resend(resendConfig.apiKey);
  }

  async sendOtpEmail(to: string, code: string): Promise<void> {
    // Logged unconditionally so the code is readable straight from the
    // server console during dev/test, same as ConsoleSmsProvider does for
    // phone OTP — this still sends the real email below via Resend.
    this.logger.log(`[DEV EMAIL] OTP for ${to}: ${code}`);

    const { error } = await this.client.emails.send({
      from: resendConfig.fromAddress,
      to: [to],
      subject: `${code} คือรหัสยืนยันอีเมลของคุณ — FitWork`,
      text: `รหัสยืนยันอีเมลของคุณคือ ${code}\n\nรหัสนี้จะหมดอายุใน 10 นาที หากคุณไม่ได้ทำรายการนี้ กรุณาเพิกเฉยต่ออีเมลฉบับนี้`,
      html: `<p>รหัสยืนยันอีเมลของคุณคือ</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px">${code}</p><p>รหัสนี้จะหมดอายุใน 10 นาที หากคุณไม่ได้ทำรายการนี้ กรุณาเพิกเฉยต่ออีเมลฉบับนี้</p>`,
    });

    if (error) {
      throw new Error(`Failed to send OTP email via Resend: ${error.message}`);
    }
  }
}
