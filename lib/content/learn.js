export const ARTICLES = [
  {
    slug: "order-types",
    title: "Market, limit and stop-limit orders explained",
    summary: "Choose the right order type for speed, price control or automated entries and exits.",
    level: "Beginner",
    minutes: 6,
    category: "Trading",
    sections: [
      {
        heading: "Market orders",
        body: [
          "A market order executes immediately at the best available price. It prioritises speed over price, so the final price can differ slightly from the last price you saw — especially in fast or thin markets.",
          "On HarborFinance, funds for a market buy are reserved with a small buffer and any unused amount is returned the moment the order fills.",
        ],
      },
      {
        heading: "Limit orders",
        body: [
          "A limit order sets the worst price you are willing to accept. A buy limit fills at your price or lower; a sell limit fills at your price or higher.",
          "If the market has not reached your price, the order rests in Open Orders with its funds reserved until it fills or you cancel it. Large orders may fill in several parts, shown as Partially Filled.",
        ],
      },
      {
        heading: "Stop-limit orders",
        body: [
          "A stop-limit order waits until the market touches a stop price, then places a limit order at your limit price. Traders use them to enter on a breakout or to limit losses on an existing position.",
          "Because the triggered order is a limit order, it is not guaranteed to fill if the market moves quickly past your limit price.",
        ],
      },
      {
        heading: "Fees and totals",
        body: [
          "Every order ticket shows the estimated fee and total before you confirm. Orders that rest on the book and fill later are charged the maker rate; orders that execute immediately are charged the taker rate.",
        ],
      },
    ],
  },
  {
    slug: "reading-candlestick-charts",
    title: "Reading candlestick charts",
    summary: "Understand open, high, low and close — and how timeframes change the story a chart tells.",
    level: "Beginner",
    minutes: 5,
    category: "Markets",
    sections: [
      {
        heading: "Anatomy of a candle",
        body: [
          "Each candle summarises trading over one period. The body spans the open and close; the wicks mark the highest and lowest prices traded.",
          "A green candle closed above its open; a red candle closed below it.",
        ],
      },
      {
        heading: "Timeframes",
        body: [
          "Short timeframes (1m, 5m) show intraday noise and are useful for timing entries. Longer ones (4h, 1D, 1W) reveal the broader trend. Many traders confirm a signal on a higher timeframe before acting on a lower one.",
        ],
      },
      {
        heading: "Volume",
        body: [
          "Volume bars beneath the chart show how much was traded in each period. Moves on rising volume tend to carry more conviction than moves on thin volume.",
        ],
      },
    ],
  },
  {
    slug: "technical-indicators",
    title: "Moving averages, RSI, MACD and Bollinger Bands",
    summary: "What the most common indicators measure — and their limitations.",
    level: "Intermediate",
    minutes: 8,
    category: "Trading",
    sections: [
      {
        heading: "Moving averages (MA & EMA)",
        body: [
          "A simple moving average (MA) is the average closing price over a set number of periods. An exponential moving average (EMA) weights recent prices more heavily, so it reacts faster.",
          "Crossovers between a short and long average are a popular — but frequently false — trend signal.",
        ],
      },
      {
        heading: "RSI",
        body: [
          "The Relative Strength Index oscillates between 0 and 100 and compares recent gains with recent losses. Readings above 70 are often called overbought and below 30 oversold, though strong trends can stay at extremes for a long time.",
        ],
      },
      {
        heading: "MACD",
        body: [
          "MACD is the difference between a 12-period and 26-period EMA, plotted with a 9-period signal line. The histogram shows the gap between them and is used to gauge momentum.",
        ],
      },
      {
        heading: "Bollinger Bands",
        body: [
          "Bollinger Bands plot a 20-period average with bands two standard deviations above and below. Bands widen as volatility rises and narrow as it falls.",
        ],
      },
      {
        heading: "Limitations",
        body: [
          "Indicators are derived from past prices. They describe what has happened, not what will happen, and should be one input among many — never a guarantee.",
        ],
      },
    ],
  },
  {
    slug: "securing-your-account",
    title: "Securing your HarborFinance account",
    summary: "Practical steps to protect your login, devices and withdrawals.",
    level: "Beginner",
    minutes: 4,
    category: "Security",
    sections: [
      {
        heading: "Use a unique, strong password",
        body: [
          "Use a password manager to generate a long password you don't use anywhere else. HarborFinance stores only a salted Argon2 hash of your password.",
        ],
      },
      {
        heading: "Turn on two-factor authentication",
        body: ["2FA adds a time-based code from an authenticator app to every sign-in and withdrawal. Save your backup codes somewhere safe and offline."],
      },
      {
        heading: "Review your sessions",
        body: ["Settings → Sessions lists every signed-in device. End any session you don't recognise and change your password immediately."],
      },
      {
        heading: "Beware of impersonation",
        body: [
          "HarborFinance staff will never ask for your password, 2FA codes or backup codes, and will never ask you to send funds to an address to “verify” your account.",
        ],
      },
    ],
  },
  {
    slug: "stablecoins",
    title: "Stablecoins: what they are and what can go wrong",
    summary: "How dollar-pegged tokens work and the risks they still carry.",
    level: "Beginner",
    minutes: 5,
    category: "Markets",
    sections: [
      {
        heading: "The idea",
        body: [
          "Stablecoins such as USDT and USDC aim to hold a steady value of one US dollar. They are widely used as a quote currency for trading and as a place to hold value between trades.",
        ],
      },
      {
        heading: "Networks matter",
        body: [
          "The same stablecoin can exist on several blockchains (for example TRC20, ERC20 or BEP20). Always deposit and withdraw on the network selected in the form — sending on the wrong network can result in permanent loss.",
        ],
      },
      {
        heading: "Risks",
        body: [
          "Stablecoins can lose their peg, and they depend on the issuer's reserves and operations. They are not bank deposits and are not covered by deposit insurance.",
        ],
      },
    ],
  },
  {
    slug: "managing-risk",
    title: "Position sizing and managing risk",
    summary: "Simple habits that help protect your capital when markets move against you.",
    level: "Intermediate",
    minutes: 6,
    category: "Risk",
    sections: [
      {
        heading: "Size positions deliberately",
        body: ["Decide in advance how much of your portfolio you are prepared to lose on a single idea. Many traders cap this at a small percentage."],
      },
      {
        heading: "Plan your exit",
        body: ["Decide where you would be wrong before entering. A stop-limit order can automate that exit, though it may not fill in a fast market."],
      },
      {
        heading: "Diversify thoughtfully",
        body: ["Many digital assets move together during market stress. Holding several highly correlated tokens offers less protection than it appears."],
      },
      {
        heading: "Avoid leverage you don't understand",
        body: ["HarborFinance spot trading does not use leverage. Borrowed exposure elsewhere can magnify losses beyond your initial capital."],
      },
    ],
  },
];
