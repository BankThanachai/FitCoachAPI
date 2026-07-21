import type { StringValue } from 'ms';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const authConfig = {
  get accessSecret(): string {
    return requireEnv('JWT_ACCESS_SECRET');
  },
  get accessExpiresIn(): StringValue {
    return (process.env.JWT_ACCESS_EXPIRES_IN ?? '15m') as StringValue;
  },
  get refreshExpiresIn(): string {
    return process.env.JWT_REFRESH_EXPIRES_IN ?? '30d';
  },
};
