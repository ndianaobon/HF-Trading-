import { z } from "zod";

/** Shared validation schemas — used by API routes and client forms. */

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address").max(254);

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(128, "Password is too long")
  .regex(/[a-z]/, "Include a lowercase letter")
  .regex(/[A-Z]/, "Include an uppercase letter")
  .regex(/[0-9]/, "Include a number")
  .regex(/[^A-Za-z0-9]/, "Include a symbol");

const name = (label) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(60)
    .regex(/^[\p{L}\p{M}' .-]+$/u, `${label} contains invalid characters`);

export const registerSchema = z
  .object({
    firstName: name("First name"),
    lastName: name("Last name"),
    email: emailSchema,
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number")
      .optional()
      .or(z.literal("")),
    country: z.string().length(2, "Select your country"),
    password: passwordSchema,
    confirmPassword: z.string(),
    referralCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{4,16}$/, "Invalid referral code")
      .optional()
      .or(z.literal("")),
    acceptTerms: z.literal(true, { errorMap: () => ({ message: "You must accept the Terms of Service and Risk Disclosure" }) }),
  })
  .refine((d) => d.password === d.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password").max(128),
  remember: z.boolean().optional().default(false),
});

export const totpSchema = z.object({ code: z.string().trim().min(6, "Enter the 6-digit code").max(12) });

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({ token: z.string().min(20), password: passwordSchema, confirmPassword: z.string() })
  .refine((d) => d.password === d.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" });

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, "Enter your current password"), newPassword: passwordSchema, confirmPassword: z.string() })
  .refine((d) => d.newPassword === d.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" })
  .refine((d) => d.newPassword !== d.currentPassword, { path: ["newPassword"], message: "Choose a different password" });

export const profileSchema = z.object({
  firstName: name("First name"),
  lastName: name("Last name"),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number")
    .optional()
    .or(z.literal("")),
  country: z.string().length(2),
  city: z.string().trim().max(80).optional().or(z.literal("")),
  addressLine: z.string().trim().max(160).optional().or(z.literal("")),
  postalCode: z.string().trim().max(20).optional().or(z.literal("")),
  timezone: z.string().trim().max(60).optional().or(z.literal("")),
});

export const preferencesSchema = z.object({
  defaultMarket: z
    .string()
    .regex(/^[A-Z0-9]{2,10}-[A-Z]{3,5}$/)
    .optional(),
  hideSmallBalances: z.boolean().optional(),
  confirmOrders: z.boolean().optional(),
  notifications: z
    .object({
      trades: z.boolean(),
      deposits: z.boolean(),
      withdrawals: z.boolean(),
      security: z.literal(true),
      investments: z.boolean(),
      announcements: z.boolean(),
    })
    .partial()
    .optional(),
});

const decimalString = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "Enter a valid number")
  .refine((v) => Number(v) > 0, "Must be greater than zero");

export const orderSchema = z
  .object({
    market: z.string().regex(/^[A-Z0-9]{2,10}-[A-Z]{3,5}$/),
    side: z.enum(["BUY", "SELL"]),
    type: z.enum(["MARKET", "LIMIT", "STOP_LIMIT"]),
    quantity: decimalString,
    price: decimalString.optional(),
    stopPrice: decimalString.optional(),
    clientOrderId: z.string().max(64).optional(),
  })
  .refine((o) => o.type === "MARKET" || !!o.price, { path: ["price"], message: "Enter a limit price" })
  .refine((o) => o.type !== "STOP_LIMIT" || !!o.stopPrice, { path: ["stopPrice"], message: "Enter a stop price" });

export const botSchema = z
  .object({
    name: z.string().max(60).optional(),
    strategy: z.enum(["DCA", "PRICE_TRIGGER"]),
    market: z.string().regex(/^[A-Z0-9]{2,10}-[A-Z]{3,5}$/),
    side: z.enum(["BUY", "SELL"]),
    amount: decimalString,
    intervalMinutes: z.coerce.number().int().refine((m) => [60, 240, 1440, 10080].includes(m), "Choose a schedule").optional(),
    maxRuns: z.coerce.number().int().min(1).max(1000).optional(),
    triggerPrice: decimalString.optional(),
    triggerDirection: z.enum(["ABOVE", "BELOW"]).optional(),
  })
  .refine((b) => b.strategy !== "DCA" || !!b.intervalMinutes, { path: ["intervalMinutes"], message: "Choose a schedule" })
  .refine((b) => b.strategy !== "PRICE_TRIGGER" || (!!b.triggerPrice && !!b.triggerDirection), { path: ["triggerPrice"], message: "Enter a trigger price" });

export const botStatusSchema = z.object({ status: z.enum(["ACTIVE", "PAUSED"]) });

export const withdrawalSchema = z.object({
  asset: z.string().min(2).max(10),
  network: z.string().min(2).max(20),
  address: z.string().trim().min(10, "Enter a destination address").max(128),
  memo: z.string().trim().max(64).optional(),
  amount: decimalString,
  code: z.string().trim().max(12).optional(),
  password: z.string().max(128).optional(),
});

export const transferSchema = z.object({
  asset: z.string().min(2).max(10),
  recipientEmail: emailSchema,
  amount: decimalString,
  note: z.string().trim().max(140).optional(),
  code: z.string().trim().max(12).optional(),
  password: z.string().max(128).optional(),
});

export const depositReportSchema = z.object({
  asset: z.string().min(2).max(10),
  network: z.string().min(2).max(20),
  amount: decimalString,
  txHash: z
    .string()
    .trim()
    .min(10, "Enter the transaction hash")
    .max(128)
    .regex(/^[A-Za-z0-9]+$/, "Invalid transaction hash"),
});

export const simulateDepositSchema = z.object({ asset: z.string().min(2).max(10), network: z.string().min(2).max(20), amount: decimalString });

export const investSchema = z.object({ planId: z.string().min(1), amount: decimalString, acceptTerms: z.boolean() });

export const copySchema = z
  .object({ traderId: z.string().min(1), allocation: decimalString, amountPerTrade: decimalString, stopLossPct: z.coerce.number().min(5).max(90) })
  .refine((d) => Number(d.amountPerTrade) <= Number(d.allocation), { path: ["amountPerTrade"], message: "Must not be more than the copy amount" });

export const TICKET_CATEGORIES = ["ACCOUNT", "DEPOSIT", "WITHDRAWAL", "TRADING", "INVESTMENT", "KYC", "SECURITY", "TECHNICAL", "OTHER"];
export const TICKET_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"];

export const ticketSchema = z.object({
  subject: z.string().trim().min(5, "Subject is too short").max(140),
  category: z.enum(TICKET_CATEGORIES),
  priority: z.enum(TICKET_PRIORITIES),
  message: z.string().trim().min(10, "Please describe the issue (10+ characters)").max(5000),
});

export const messageSchema = z.object({ body: z.string().trim().min(1, "Message cannot be empty").max(5000) });

export const kycSchema = z.object({
  fullName: z.string().trim().min(3).max(120),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  country: z.string().length(2),
  addressLine: z.string().trim().min(3).max(160),
  city: z.string().trim().min(2).max(80),
  postalCode: z.string().trim().min(2).max(20),
  idType: z.enum(["PASSPORT", "NATIONAL_ID", "DRIVERS_LICENSE"]),
  idNumber: z.string().trim().min(4).max(40),
});

export const contactSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: emailSchema,
  topic: z.string().trim().min(2).max(60),
  message: z.string().trim().min(10).max(4000),
});
