-- AlterTable
-- Reverts 20261003000000_add_otp_resend_lockout: the OTP resend cooldown
-- goes back to a plain 60s wait with no account-level lock on repeated
-- rejections — only wrong-code attempts (via emailOtpLockedUntil /
-- phoneOtpLockedUntil) still trigger a lock.
ALTER TABLE "User" DROP COLUMN "emailResendAttempts";
ALTER TABLE "User" DROP COLUMN "phoneResendAttempts";
