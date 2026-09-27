export const PERMISSIONS = [
  "users.read",
  "users.manage",
  "kyc.read",
  "kyc.review",
  "wallets.read",
  "deposits.read",
  "deposits.review",
  "withdrawals.read",
  "withdrawals.review",
  "transactions.read",
  "trades.read",
  "markets.manage",
  "plans.manage",
  "copytraders.manage",
  "autobot.manage",
  "referrals.manage",
  "support.read",
  "support.reply",
  "notifications.send",
  "reports.read",
  "settings.manage",
  "audit.read",
  "admins.manage",
];

const ROLE_PERMISSIONS = {
  SUPER_ADMIN: PERMISSIONS,
  ADMIN: PERMISSIONS.filter((p) => p !== "admins.manage"),
  COMPLIANCE: [
    "users.read",
    "kyc.read",
    "kyc.review",
    "wallets.read",
    "deposits.read",
    "withdrawals.read",
    "transactions.read",
    "trades.read",
    "reports.read",
    "audit.read",
  ],
  FINANCE: [
    "users.read",
    "wallets.read",
    "deposits.read",
    "deposits.review",
    "withdrawals.read",
    "withdrawals.review",
    "transactions.read",
    "trades.read",
    "reports.read",
    "plans.manage",
    "referrals.manage",
  ],
  SUPPORT: ["users.read", "kyc.read", "transactions.read", "support.read", "support.reply", "notifications.send"],
};

export function can(role, permission) {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsFor(role) {
  return ROLE_PERMISSIONS[role];
}
