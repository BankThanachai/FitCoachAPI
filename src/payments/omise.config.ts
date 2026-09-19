function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const omiseConfig = {
  get secretKey(): string {
    return requireEnv('OMISE_SECRET_KEY');
  },
  get publicKey(): string {
    return requireEnv('OMISE_PUBLIC_KEY');
  },
  get webhookSecret(): string | undefined {
    return process.env.OMISE_WEBHOOK_SECRET;
  },
};
