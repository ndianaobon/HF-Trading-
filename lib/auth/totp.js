import "server-only";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import { hash, verify } from "@node-rs/argon2";
import { prisma } from "@/lib/db/prisma";
import { decrypt, encrypt, randomToken } from "@/lib/security/crypto";

authenticator.options = { window: 1, step: 30 };

const ISSUER = "HarborFinance";

export async function beginTotpEnrollment(userId, email) {
  const secret = authenticator.generateSecret(20);
  await prisma.twoFactorAuth.upsert({
    where: { userId },
    create: { userId, secretEncrypted: encrypt(secret), enabled: false, backupCodes: [] },
    update: { secretEncrypted: encrypt(secret), enabled: false, backupCodes: [], lastUsedStep: null },
  });
  const otpauth = authenticator.keyuri(email, ISSUER, secret);
  const qrDataUrl = await QRCode.toDataURL(otpauth, { margin: 1, width: 220, color: { dark: "#0B1220", light: "#FFFFFF" } });
  return { secret, qrDataUrl };
}

const currentStep = () => Math.floor(Date.now() / 1000 / 30);

/**
 * Verifies a TOTP code with replay protection (each time-step can be used
 * only once) or a single-use backup code.
 */
export async function verifySecondFactor(userId, code, opts = {}) {
  const record = await prisma.twoFactorAuth.findUnique({ where: { userId } });
  if (!record || (!record.enabled && !opts.allowDisabled)) return false;
  const clean = code.replace(/\s|-/g, "");

  if (/^\d{6}$/.test(clean)) {
    const secret = decrypt(record.secretEncrypted);
    const delta = authenticator.checkDelta(clean, secret);
    if (delta === null) return false;
    const step = currentStep() + delta;
    if (record.lastUsedStep !== null && step <= record.lastUsedStep) return false;
    const { count } = await prisma.twoFactorAuth.updateMany({
      where: { userId, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }] },
      data: { lastUsedStep: step },
    });
    return count === 1;
  }

  if (record.enabled && /^[a-z0-9]{10}$/i.test(clean)) {
    for (let i = 0; i < record.backupCodes.length; i++) {
      if (await verify(record.backupCodes[i], clean.toLowerCase()).catch(() => false)) {
        const remaining = record.backupCodes.filter((_, idx) => idx !== i);
        await prisma.twoFactorAuth.update({ where: { userId }, data: { backupCodes: remaining } });
        return true;
      }
    }
  }
  return false;
}

export async function generateBackupCodes() {
  const plain = Array.from({ length: 8 }, () =>
    randomToken(12)
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase()
      .slice(0, 10)
      .padEnd(10, "7"),
  );
  const hashed = await Promise.all(plain.map((c) => hash(c)));
  return { plain, hashed };
}
