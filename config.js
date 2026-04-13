module.exports = {
  guildId: process.env.GUILD_ID,

  supportRoleId: "1480671765909733472",

  ticketsCategoryId: 1480671767453499498,

  brandColor: 0x67E6CD,

  logoUrl:
    "https://cdn.discordapp.com/attachments/1462866074436636706/1482088886867067072/feab6214-549d-464e-a629-bb9ff6c142c4_removalai_preview.png",

  ticketPanel: {
    title: "Welcome to Niro Market",
    description:
      "Need assistance? Select a category below to open a ticket with our team."
  },

  ticketOptions: [
    {
      label: "Questions",
      description: "General questions and help",
      value: "questions",
      emoji: "❓"
    },
    {
      label: "Purchase",
      description: "Buy products from Niro Market",
      value: "purchase",
      emoji: "🛒"
    },
    {
      label: "Support",
      description: "Product support and assistance",
      value: "support",
      emoji: "🆘"
    },
    {
      label: "Replacement",
      description: "Replacement request for a product",
      value: "replacement",
      emoji: "♻️"
    },
    {
      label: "Giveaway Winner",
      description: "Claim a giveaway or invite reward",
      value: "giveaway_winner",
      emoji: "🎉"
    }
  ],

  paymentMethods: [
    {
      label: "Crypto",
      description: "Pay with BTC or LTC",
      value: "crypto",
      emoji: "💸"
    },
    {
      label: "PayPal",
      description: "Pay with PayPal",
      value: "paypal",
      emoji: "💙"
    },
    {
      label: "Something Else",
      description: "Use another payment method",
      value: "something_else",
      emoji: "🧾"
    }
  ],

  cryptoWallets: {
    btc: {
      symbol: "BTC",
      address: "bc1q7vlpg2c38xfpn0twsgq2ms5lvaz2n5k2m3k26y",
      network: "Bitcoin",
      coinGeckoId: "bitcoin",
      decimals: 8
    },
    ltc: {
      symbol: "LTC",
      address: "LbCXNXAZtJbcx42RRce4ht778enUCTg5yF",
      network: "Litecoin",
      coinGeckoId: "litecoin",
      decimals: 8
    }
  },

  paypal: {
    email: "demonslatino@gmail.com"
  },

  stockSource: {
    channelId: "1484837636635099146",
    messageId: "1485263280120397925"
  },

  purchaseCatalog: [
    {
      label: "Fivem Premium Accounts",
      value: "item_fivem-premium-accounts",
      price: 0.10,
      emoji: "🔥",
      description: "Fallback item"
    },
    {
      label: "Fivem Standard Accounts",
      value: "item_fivem-standard-accounts",
      price: 0.05,
      emoji: "🎮",
      description: "Fallback item"
    },
    {
      label: "Steam Fresh Accounts",
      value: "item_steam-fresh-accounts",
      price: 0.02,
      emoji: "💨",
      description: "Fallback item"
    },
    {
      label: "Fresh Emails",
      value: "item_fresh-emails",
      price: 0.01,
      emoji: "📧",
      description: "Fallback item"
    },
    {
      label: "Mullvad Account Lifetime",
      value: "item_mullvad-account-lifetime",
      price: 0.0,
      emoji: "🔐",
      description: "Fallback item"
    },
    {
      label: "Discord Checked Accounts",
      value: "item_discord-checked-accounts",
      price: 0.10,
      emoji: "💬",
      description: "Fallback item"
    },
    {
      label: "Discord Non Checked Accounts",
      value: "item_discord-non-checked-accounts",
      price: 0.05,
      emoji: "💬",
      description: "Fallback item"
    }
  ]
};
