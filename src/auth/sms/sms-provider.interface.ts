// Common interface every SMS backend implements, so AuthService never talks
// to a specific vendor directly. Swap implementations via SMS_PROVIDER
// (see sms.config.ts) without touching call sites.
export interface SmsProvider {
  sendOtpSms(to: string, code: string): Promise<void>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
