function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const firebaseConfig = {
  get serviceAccountPath(): string {
    return requireEnv('FIREBASE_SERVICE_ACCOUNT_PATH');
  },
};
