import "server-only";
import { prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/api/errors";
import { verifySecondFactor } from "./totp";
import { verifyPassword } from "./password";

/**
 * Step-up confirmation for sensitive actions (withdrawals, transfers, API keys,
 * disabling 2FA). Requires a TOTP/backup code when 2FA is enabled, otherwise
 * the account password.
 */
export async function confirmSensitiveAction(userId, input) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { twoFactor: true } });
  if (user.twoFactor?.enabled) {
    if (!input.code) throw new AppError("INVALID_2FA_CODE", "Enter the 6-digit code from your authenticator app.");
    if (!(await verifySecondFactor(userId, input.code))) throw new AppError("INVALID_2FA_CODE");
    return "2fa";
  }
  if (!input.password) throw new AppError("VALIDATION_ERROR", "Enter your account password to confirm.");
  if (!(await verifyPassword(user.passwordHash, input.password))) throw new AppError("INVALID_CREDENTIALS", "Password is incorrect.");
  return "password";
}
