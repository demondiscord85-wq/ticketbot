module.exports = {
  guildId: process.env.GUILD_ID,
  supportRoleId: "1480671765909733472",
  ticketsCategoryId: "1480671767453499498",
  panelChannelId: "1480671767453499499",
  brandColor: 0x67E6CD,
  logoUrl:
    "https://cdn.discordapp.com/attachments/1462866074436636706/1482088886867067072/feab6214-549d-464e-a629-bb9ff6c142c4_removalai_preview.png",

  ticketPanel: {
    title: "Welcome to Niro Market",
    description:
      "Need assistance? Select a category below to connect with our dedicated team. We're here to help you with any questions or inquiries you may have."
  },

  ticketOptions: [
    {
      label: "Questions",
      description: "To ask your general queries",
      value: "questions",
      emoji: "❓"
    },
    {
      label: "Purchase",
      description: "Purchase Ticket",
      value: "purchase",
      emoji: "🛒"
    },
    {
      label: "Support",
      description: "Support for product",
      value: "support",
      emoji: "🛠️"
    },
    {
      label: "Replacement",
      description: "Replacement for your product",
      value: "replacement",
      emoji: "♻️"
    },
    {
      label: "Giveaway winner",
      description: "Invite reward/giveaway winner",
      value: "giveaway_winner",
      emoji: "🎉"
    }
  ],

purchaseCatalog: [
  {
    label: "Fivem Premium Accounts",
    description: "2FA secured • Premium quality • Active support",
    value: "option_1",
    emoji: "🔥",
    price: 0.10
  },
  {
    label: "Fivem Standard Accounts",
    description: "Standard quality • May have issues • No refund or replacement",
    value: "option_2",
    emoji: "🎮",
    price: 0.05
  },
  {
    label: "Steam Fresh Accounts",
    description: "Fresh account • Clean stock • Active support",
    value: "option_3",
    emoji: "💨",
    price: 0.02
  },
  {
    label: "Fresh Emails",
    description: "Fresh emails • Good for bulk account creation",
    value: "option_4",
    emoji: "📧",
    price: 0.01
  }
],

  paymentMethods: [
    {
      label: "Crypto",
      description: "Pay with crypto using a fixed wallet",
      value: "crypto",
      emoji: "🪙",
      defaultCoin: "btc"
    },
    {
      label: "QR",
      description: "Pay using a QR code",
      value: "qr",
      emoji: "📷"
    },
    {
      label: "PayPal",
      description: "Pay with PayPal only (Friends and Family)",
      value: "paypal",
      emoji: "💙"
    },
    {
      label: "Something else",
      description: "Wait for owner instructions",
      value: "something_else",
      emoji: "💬"
    }
  ],

  cryptoWallets: {
    btc: {
      symbol: "BTC",
      coinGeckoId: "bitcoin",
      address: "bc1q7vlpg2c38xfpn0twsgq2ms5lvaz2n5k2m3k26y",
      network: "Bitcoin",
      decimals: 8
    },
    ltc: {
      symbol: "LTC",
      coinGeckoId: "litecoin",
      address: "LbCXNXAZtJbcx42Rrce4ht778enUCTg5yF",
      network: "Litecoin",
      decimals: 6
    }
  },

  paypal: {
    email: "demonslatino@gmail.com"
  },

  qrPayment: {
    text: "Scan one of the QR codes below and send the exact amount.",
    imageUrls: [
      "https://cdn.discordapp.com/attachments/1462866074436636706/1487197453282316389/image.png?ex=69c8440f&is=69c6f28f&hm=ab10553a08f793c6dc57317353bca86d22aa387832d07180bf186f430b19249f&",
      "https://cdn.discordapp.com/attachments/1462866074436636706/1487197453600952520/image.png?ex=69c8440f&is=69c6f28f&hm=0589afac50979b2f09fc9969cd76e14e1ca498fa39d3ab166a1c727f8fe6258f&"
    ]
  }
};
