/** Stable, user-safe error codes. Messages never include internals. */
export const ERROR_CATALOG = {
  VALIDATION_ERROR: { status: 400, message: "Some of the information provided is invalid." },
  UNAUTHENTICATED: { status: 401, message: "Please log in to continue." },
  SESSION_EXPIRED: { status: 401, message: "Your session has expired. Please log in again." },
  MFA_REQUIRED: { status: 401, message: "Two-factor authentication is required." },
  ADMIN_MFA_REQUIRED: { status: 403, message: "Staff accounts must enable two-factor authentication before using the admin console." },
  INVALID_CREDENTIALS: { status: 401, message: "Email or password is incorrect." },
  INVALID_2FA_CODE: { status: 400, message: "The verification code is invalid or has expired." },
  FORBIDDEN: { status: 403, message: "You do not have permission to perform this action." },
  EMAIL_NOT_VERIFIED: { status: 403, message: "Please verify your email address first." },
  ACCOUNT_SUSPENDED: { status: 403, message: "This account is suspended. Please contact support." },
  ACCOUNT_LOCKED: { status: 423, message: "Too many failed attempts. Try again later." },
  KYC_REQUIRED: { status: 403, message: "Identity verification is required for this action." },
  NOT_FOUND: { status: 404, message: "The requested resource was not found." },
  CONFLICT: { status: 409, message: "This request conflicts with the current state." },
  DUPLICATE_REQUEST: { status: 409, message: "This request has already been processed." },
  EMAIL_IN_USE: { status: 409, message: "An account with this email already exists." },
  INSUFFICIENT_BALANCE: { status: 422, message: "Insufficient available balance." },
  INVALID_ADDRESS: { status: 422, message: "The destination address is not valid for this network." },
  UNSUPPORTED_NETWORK: { status: 422, message: "This network is not supported for the selected asset." },
  BELOW_MINIMUM: { status: 422, message: "The amount is below the minimum allowed." },
  ABOVE_MAXIMUM: { status: 422, message: "The amount exceeds the maximum allowed." },
  MARKET_UNAVAILABLE: { status: 503, message: "This market is currently unavailable." },
  MARKET_DATA_UNAVAILABLE: { status: 503, message: "Market data is temporarily unavailable." },
  ORDER_REJECTED: { status: 422, message: "The order was rejected." },
  WITHDRAWAL_UNAVAILABLE: { status: 503, message: "Withdrawals are currently unavailable for this asset." },
  DEPOSIT_UNAVAILABLE: { status: 503, message: "Deposits are currently unavailable for this network." },
  FEATURE_DISABLED: { status: 403, message: "This feature is not available." },
  RATE_LIMITED: { status: 429, message: "Too many requests. Please slow down and try again shortly." },
  INVALID_TOKEN: { status: 400, message: "This link is invalid or has expired." },
  CSRF_FAILED: { status: 403, message: "Request origin could not be verified." },
  INTERNAL_ERROR: { status: 500, message: "Something went wrong on our side. Please try again." },
};

export class AppError extends Error {
  code;
  status;
  details;

  constructor(code, message, details) {
    super(message ?? ERROR_CATALOG[code].message);
    this.code = code;
    this.status = ERROR_CATALOG[code].status;
    this.details = details;
  }
}

export const isAppError = (e) => e instanceof AppError;
