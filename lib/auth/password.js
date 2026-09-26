import "server-only";
import { hash, verify } from "@node-rs/argon2";

// Argon2id with OWASP-recommended parameters.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 };

export const hashPassword = (password) => hash(password, OPTIONS);

export async function verifyPassword(passwordHash, password) {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Constant-ish time dummy verification to avoid user enumeration via timing. */
const DUMMY_HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$0v1H3Qm2wY5v8mUj8QhN7qfG0kS3y0l2Zb1w2Rr1bJk";
export async function dummyVerify(password) {
  await verifyPassword(DUMMY_HASH, password);
}
