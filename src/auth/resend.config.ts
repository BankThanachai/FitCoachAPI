function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const resendConfig = {
  get apiKey(): string {
    return requireEnv('RESEND_API_KEY');
  },
  get fromAddress(): string {
    // `??` alone only falls back on undefined/null — an .env line like
    // `RESEND_FROM_ADDRESS=` (present but empty) sets this to `""`, which
    // is neither, so it would be sent to Resend as-is and get rejected with
    // a 422 "The domain is invalid". Treat a blank value as unset too.
    return (
      process.env.RESEND_FROM_ADDRESS?.trim() ||
      'FitWork <onboarding@resend.dev>'
    );
  },
};
