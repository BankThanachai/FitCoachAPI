// SMS_PROVIDER selects which SmsProvider implementation sms.module.ts wires
// up. "console" (the default) just logs the OTP — safe for local dev and
// tests since it never calls out to a real gateway or costs anything.
// A real gateway (e.g. "thaibulksms") can be added here later without
// touching AuthService, which only ever depends on the SmsProvider interface.
export type SmsProviderName = 'console';

export const smsConfig = {
  get provider(): SmsProviderName {
    const value = process.env.SMS_PROVIDER ?? 'console';
    if (value !== 'console') {
      throw new Error(
        `Unknown SMS_PROVIDER "${value}". Only "console" is implemented so far.`,
      );
    }
    return value;
  },
};
