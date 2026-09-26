export const FAQ_GROUPS = [
  {
    id: "account",
    title: "Account & verification",
    items: [
      {
        q: "How do I create an account?",
        a: "Select Create Account, enter your details and choose a strong password. We'll email you a link to verify your address. You can explore the dashboard straight away, but funding and trading require a verified email.",
      },
      {
        q: "Why do I need to verify my identity?",
        a: "Depending on the actions you take and applicable requirements, we may need to verify your identity before withdrawals or plan subscriptions. You can check what's required in Dashboard → Verification.",
      },
      { q: "I didn't receive the verification email.", a: "Check your spam folder, then use Resend on the verification page. Links expire after 24 hours." },
      {
        q: "How do I close my account?",
        a: "Withdraw your balances, then open a support ticket asking for closure. Some records must be retained after closure as described in our Privacy Policy.",
      },
    ],
  },
  {
    id: "funding",
    title: "Deposits & withdrawals",
    items: [
      {
        q: "Which networks can I deposit on?",
        a: "Each asset lists its supported networks, minimum deposit and required confirmations on the Deposit page. Always send on exactly the network selected — funds sent on the wrong network may be lost.",
      },
      {
        q: "When is my deposit credited?",
        a: "Deposits are credited after the required number of network confirmations, or after review where manual verification applies. You'll see the status move from Pending to Confirming to Completed.",
      },
      {
        q: "How long do withdrawals take?",
        a: "Withdrawals are reviewed before processing. Where an estimated processing time has been configured for a network, it's shown in the withdrawal form. Network conditions can add delays.",
      },
      {
        q: "What fees apply to withdrawals?",
        a: "A network fee per asset and network is shown in the form and on the Fees page. It's deducted in addition to the amount you withdraw.",
      },
    ],
  },
  {
    id: "trading",
    title: "Trading",
    items: [
      { q: "What order types are available?", a: "Market, limit and stop-limit orders. See Learn → Order types for detailed examples." },
      {
        q: "Why is my order partially filled?",
        a: "A limit order may fill in several parts as liquidity becomes available at your price. The remaining quantity stays open until filled or cancelled.",
      },
      {
        q: "Why was my order rejected?",
        a: "Common reasons include insufficient available balance, an order below the minimum size or value, a limit price too far from the market, or a temporarily unavailable market. The rejection reason is shown in Order History.",
      },
      {
        q: "What happens if market data is unavailable?",
        a: "New orders are blocked while live prices are unavailable. We never execute against stale or estimated prices.",
      },
    ],
  },
  {
    id: "products",
    title: "Investment plans & copy trading",
    items: [
      {
        q: "Are returns guaranteed?",
        a: "No. Investment plans and copy trading carry risk. Results can be negative and you may get back less than you allocated.",
      },
      {
        q: "How are plan fees charged?",
        a: "A management fee accrues pro-rata over the time your allocation is active, and a performance fee applies only to positive realised results. Both are deducted at settlement.",
      },
      {
        q: "Can I stop copying a trader?",
        a: "Yes, at any time from Dashboard → Copy Trading. Your allocation plus or minus any recorded result is returned to your wallet.",
      },
    ],
  },
  {
    id: "security",
    title: "Security",
    items: [
      {
        q: "How do I enable two-factor authentication?",
        a: "Go to Settings → Security, choose Enable 2FA, scan the QR code with an authenticator app and confirm with a 6-digit code. Save your backup codes somewhere safe.",
      },
      {
        q: "I lost my authenticator device.",
        a: "Use one of your backup codes to sign in, then disable and re-enable 2FA with your new device. If you have no backup codes, contact support to begin account recovery.",
      },
      { q: "Will HarborFinance ever ask for my password?", a: "Never. We will not ask for your password, 2FA codes or backup codes by email, chat or phone." },
    ],
  },
];
