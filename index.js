require("dotenv").config();

const express = require("express");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  REST,
  Routes,
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags
} = require("discord.js");
const discordTranscripts = require("discord-html-transcripts");

const config = require("./config");

const TOKEN = (process.env.TOKEN || "").trim();
const CLIENT_ID = (process.env.CLIENT_ID || "").trim();
const GUILD_ID = (process.env.GUILD_ID || config.guildId || "").trim();

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("UNCAUGHT EXCEPTION:", error);
});

process.on("warning", (warning) => {
  console.warn("NODE WARNING:", warning);
});

// -------------------- WEB SERVER --------------------
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (_req, res) => {
  res.send("Niro Market bot is running.");
});

app.get("/health", (_req, res) => {
  res.status(200).send("OK");
});

app.listen(PORT, () => {
  console.log(`Web server listening on port ${PORT}`);
});

// -------------------- DISCORD CLIENT --------------------
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// -------------------- CONFIG --------------------
const SUPPORT_ROLE_ID = config.supportRoleId || "";
const BRAND_COLOR = config.brandColor || 0x67E6CD;
const LOGO_URL = config.logoUrl || "";
const TICKETS_CATEGORY_ID = config.ticketsCategoryId || null;
const LOGS_CHANNEL_ID = config.logsChannelId || "";
const TICKET_PANEL = config.ticketPanel || {
  title: "Welcome to Niro Market",
  description: "Select a category below to open a ticket."
};

const ticketOptions = config.ticketOptions || [];
const paymentMethods = (config.paymentMethods || []).filter(
  (method) => method.value !== "qr"
);
const cryptoWallets = config.cryptoWallets || {};
const paypalConfig = config.paypal || {};
const fallbackPurchaseCatalog = config.purchaseCatalog || [];

const STOCK_CHANNEL_ID = config.stockSource?.channelId || "1484837636635099146";
const STOCK_MESSAGE_ID = config.stockSource?.messageId || "1485263280120397925";

const purchaseStates = new Map();

const commands = [
  new SlashCommandBuilder()
    .setName("ticket-setup")
    .setDescription("Send the Niro Market ticket panel")
    .toJSON()
];

// -------------------- HELPERS --------------------
function normalizeName(str) {
  return str
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "")
    .slice(0, 30);
}

function normalizeKey(str) {
  return str
    .toLowerCase()
    .replace(/[`>*+_]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getTicketOption(value) {
  return ticketOptions.find((x) => x.value === value);
}

function findOpenTicketByUser(guild, userId) {
  return guild.channels.cache.find(
    (ch) =>
      ch.type === ChannelType.GuildText &&
      ch.topic &&
      ch.topic.includes(`ticket-owner:${userId}`)
  );
}

function formatEuro(value) {
  return `€${Number(value).toFixed(2)}`;
}

function getPaymentMethod(value) {
  return paymentMethods.find((method) => method.value === value);
}

function getPurchaseState(channelId) {
  if (!purchaseStates.has(channelId)) {
    purchaseStates.set(channelId, {
      product: null,
      quantity: null,
      total: null,
      paymentMethod: null,
      submitted: false,
      txAttempts: 0,
      cryptoQuotes: {},
      unlocked: false,
      verifiedTxid: null,
      paypalScreenshotUrl: null,
      stockItems: []
    });
  }

  return purchaseStates.get(channelId);
}

function isValidImageUrl(url) {
  return (
    /^https?:\/\/.+\.(png|jpg|jpeg|webp|gif)(\?.*)?$/i.test(url) ||
    url.includes("cdn.discordapp.com") ||
    url.includes("media.discordapp.net") ||
    url.includes("i.imgur.com")
  );
}

function labelToValue(label) {
  return `item_${normalizeName(label)}`;
}

function getTicketOwnerIdFromTopic(topic = "") {
  const match = topic.match(/ticket-owner:(\d+)/);
  return match ? match[1] : null;
}

function getTicketTypeFromTopic(topic = "") {
  const match = topic.match(/ticket-type:([^\s|]+)/);
  return match ? match[1] : "unknown";
}

async function createTicketTranscript(channel) {
  return await discordTranscripts.createTranscript(channel, {
    limit: -1,
    filename: `${channel.name}-transcript.html`,
    saveImages: true,
    poweredBy: false
  });
}

async function sendTranscriptToLogs({
  guild,
  channel,
  closedBy,
  ownerUser,
  transcriptAttachment
}) {
  if (!LOGS_CHANNEL_ID) return;

  try {
    const logsChannel = await guild.channels.fetch(LOGS_CHANNEL_ID);
    if (!logsChannel || !logsChannel.isTextBased()) return;

    const ticketType = getTicketTypeFromTopic(channel.topic || "");

    const logEmbed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setAuthor({ name: "Niro Market", iconURL: LOGO_URL || undefined })
      .setTitle("📁 Ticket Closed")
      .setDescription([
        `**Ticket:** ${channel.name}`,
        `**Owner:** ${ownerUser ? ownerUser.tag : "Unknown User"}`,
        `**Closed By:** ${closedBy.tag}`,
        `**Type:** ${ticketType}`,
        `**Channel ID:** ${channel.id}`
      ].join("\n"))
      .setFooter({
        text: "Niro Market Transcript Logs",
        iconURL: LOGO_URL || undefined
      })
      .setTimestamp();

    await logsChannel.send({
      embeds: [logEmbed],
      files: [transcriptAttachment]
    });
  } catch (error) {
    console.error("Failed to send transcript to logs:", error);
  }
}

async function sendTranscriptToUserDM(ownerUser, transcriptAttachment) {
  if (!ownerUser) return;

  try {
    const dmEmbed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setAuthor({ name: "Niro Market", iconURL: LOGO_URL || undefined })
      .setTitle("Your Ticket Transcript")
      .setDescription(
        "TO SEE THE TRANSCRIPT DOWNLOAD IT AND OPEN IT. We hope that you found what you were looking for. Here is your transcript if you ever need it."
      )
      .setFooter({
        text: "Niro Market Support",
        iconURL: LOGO_URL || undefined
      })
      .setTimestamp();

    await ownerUser.send({
      embeds: [dmEmbed],
      files: [transcriptAttachment]
    });
  } catch (error) {
    console.error("Failed to DM transcript to user:", error);
  }
}

function mapStockNameToLabel(rawName) {
  const name = normalizeKey(rawName);

  const mappings = [
    {
      keys: ["premium fivem readys", "premium fivem ready", "premium fivem"],
      label: "Fivem Premium Accounts"
    },
    {
      keys: ["standard fivem ready", "standard fivem readys", "standard fivem"],
      label: "Fivem Standard Accounts"
    },
    {
      keys: ["fresh steam accounts", "steam fresh accounts"],
      label: "Steam Fresh Accounts"
    },
    {
      keys: ["fresh mail accounts", "fresh emails", "fresh email accounts"],
      label: "Fresh Emails"
    },
    {
      keys: ["mullvad account lifetime", "mullvad account"],
      label: "Mullvad Account Lifetime"
    },
    {
      keys: ["checked accounts"],
      label: "Discord Checked Accounts"
    },
    {
      keys: ["non checked accounts", "non checked account"],
      label: "Discord Non Checked Accounts"
    }
  ];

  const found = mappings.find((entry) =>
    entry.keys.some((key) => name.includes(key))
  );

  return found ? found.label : rawName.trim();
}

function getEmojiForLabel(label) {
  const text = normalizeKey(label);

  if (text.includes("premium")) return "🔥";
  if (text.includes("standard")) return "🎮";
  if (text.includes("steam")) return "💨";
  if (text.includes("email") || text.includes("mail")) return "📧";
  if (text.includes("mullvad")) return "🔐";
  if (text.includes("discord")) return "💬";

  return "🛒";
}

function parsePrice(priceText) {
  if (!priceText) return 0;
  const cleaned = priceText.replace(",", ".").replace(/[^\d.]/g, "");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : 0;
}

function parseStockMessageText(text) {
  if (!text) return [];

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const items = [];

  for (const line of lines) {
    if (!line.includes("[") || !line.includes("]")) continue;

    const outMatch = line.match(/^[xX]\s+(.+?)\s*-\s*OUT\s*\[([0-9.,]+)€?\]/i);
    if (outMatch) {
      const rawName = outMatch[1].trim();
      const price = parsePrice(outMatch[2]);

      items.push({
        label: mapStockNameToLabel(rawName),
        value: labelToValue(mapStockNameToLabel(rawName)),
        emoji: getEmojiForLabel(rawName),
        description: "Currently out of stock",
        price,
        stock: 0,
        inStock: false
      });

      continue;
    }

    const pcsMatch = line.match(/(.+?)\s*[:\-]\s*(\d+)\s*pcs\s*\[([0-9.,]+)€?\]/i);
    if (pcsMatch) {
      const rawName = pcsMatch[1].trim();
      const stock = Number(pcsMatch[2]);
      const price = parsePrice(pcsMatch[3]);

      items.push({
        label: mapStockNameToLabel(rawName),
        value: labelToValue(mapStockNameToLabel(rawName)),
        emoji: getEmojiForLabel(rawName),
        description: `Live stock: ${stock}`,
        price,
        stock,
        inStock: stock > 0
      });

      continue;
    }
  }

  const deduped = new Map();
  for (const item of items) {
    deduped.set(item.label, item);
  }

  return [...deduped.values()];
}

function buildFallbackCatalog() {
  return fallbackPurchaseCatalog.map((item) => ({
    ...item,
    stock: 999999,
    inStock: true
  }));
}

async function fetchLiveStockCatalog(guild) {
  try {
    const channel = await guild.channels.fetch(STOCK_CHANNEL_ID, { force: true });
    if (!channel || !channel.isTextBased()) {
      throw new Error("Stock channel not found or is not text based.");
    }

    const message = await channel.messages.fetch({
      message: STOCK_MESSAGE_ID,
      force: true
    });
    if (!message) {
      throw new Error("Stock message not found.");
    }

    const parts = [];

    if (message.content) parts.push(message.content);

    for (const embed of message.embeds) {
      if (embed.title) parts.push(embed.title);
      if (embed.description) parts.push(embed.description);

      if (Array.isArray(embed.fields)) {
        for (const field of embed.fields) {
          if (field.name) parts.push(field.name);
          if (field.value) parts.push(field.value);
        }
      }
    }

    const parsed = parseStockMessageText(parts.join("\n"));
    if (!parsed.length) {
      console.warn("Stock parse returned 0 items, using fallback catalog.");
      return buildFallbackCatalog();
    }

    return parsed;
  } catch (error) {
    console.error("Failed to fetch live stock catalog:", error);
    return buildFallbackCatalog();
  }
}

async function refreshPurchaseStock(channel) {
  const state = getPurchaseState(channel.id);
  const stockItems = await fetchLiveStockCatalog(channel.guild);
  state.stockItems = stockItems;
  return stockItems;
}

function getLiveCatalogItem(channelId, value) {
  const state = getPurchaseState(channelId);
  return (state.stockItems || []).find((item) => item.value === value);
}

async function getCryptoQuote(coinId, totalEur) {
  const fallbackPrices = {
    bitcoin: 60000,
    litecoin: 70
  };

  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(
      coinId
    )}&vs_currencies=eur`;

    const response = await fetch(url, {
      headers: { accept: "application/json" }
    });

    if (!response.ok) {
      throw new Error(`CoinGecko request failed with status ${response.status}`);
    }

    const data = await response.json();
    const eurPrice = data?.[coinId]?.eur;

    if (!eurPrice) {
      throw new Error(`No EUR price found for coin: ${coinId}`);
    }

    return {
      eurPrice,
      cryptoAmount: totalEur / eurPrice,
      isFallback: false
    };
  } catch (error) {
    console.error(`Live crypto quote failed for ${coinId}:`, error);

    const eurPrice = fallbackPrices[coinId];
    if (!eurPrice) {
      throw error;
    }

    return {
      eurPrice,
      cryptoAmount: totalEur / eurPrice,
      isFallback: true
    };
  }
}

async function verifyCryptoTransaction({
  coinKey,
  txid,
  expectedWallet,
  expectedAmount
}) {
  const chainMap = {
    btc: "btc",
    ltc: "ltc"
  };

  const chain = chainMap[coinKey];
  if (!chain) {
    throw new Error(`Unsupported coin: ${coinKey}`);
  }

  const url = `https://api.blockcypher.com/v1/${chain}/main/txs/${encodeURIComponent(txid)}`;
  const response = await fetch(url, {
    headers: { accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`TX lookup failed with status ${response.status}`);
  }

  const data = await response.json();
  const confirmations = Number(data.confirmations || 0);
  const outputs = Array.isArray(data.outputs) ? data.outputs : [];

  let matchedValue = 0;

  for (const output of outputs) {
    const addresses = Array.isArray(output.addresses) ? output.addresses : [];
    if (addresses.includes(expectedWallet)) {
      matchedValue += Number(output.value || 0);
    }
  }

  const receivedAmount = matchedValue / 1e8;
  const tolerance = 0.000001;

  return {
    found: true,
    confirmed: confirmations > 0,
    confirmations,
    amountMatches: Math.abs(receivedAmount - expectedAmount) <= tolerance,
    receivedAmount
  };
}

function buildTicketPanelEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setAuthor({ name: "Niro Market", iconURL: LOGO_URL || undefined })
    .setTitle(TICKET_PANEL.title || "Welcome to Niro Market")
    .setDescription(TICKET_PANEL.description || "Select a category below to open a ticket.")
    .setThumbnail(LOGO_URL || null)
    .setFooter({ text: "Niro Market Support System", iconURL: LOGO_URL || undefined })
    .setTimestamp();
}

function buildTicketSelectRow() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("ticket_select")
    .setPlaceholder("Open a ticket")
    .addOptions(
      ticketOptions.map((option) => ({
        label: option.label,
        description: option.description?.slice(0, 100) || "Open ticket",
        value: option.value,
        emoji: option.emoji || undefined
      }))
    );

  return new ActionRowBuilder().addComponents(menu);
}

function buildPurchaseFlowEmbed(user, stockItems) {
  const productLines = stockItems.map((item, index) => {
    const status = item.inStock ? `Stock: ${item.stock}` : "OUT OF STOCK";
    return `**${index + 1}. ${item.label}** — ${formatEuro(item.price)} — **${status}**`;
  });

  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setAuthor({ name: "Niro Market", iconURL: LOGO_URL || undefined })
    .setTitle("🛒 Purchase Ticket")
    .setDescription([
      `Hello ${user}, please complete the order flow below.`,
      "",
      "**Available options**",
      ...productLines,
      "",
      "1. Choose what you want to buy",
      "2. Enter quantity",
      "3. Choose payment method",
      "4. Press Done",
      "5. Submit the required payment proof to unlock the channel"
    ].join("\n"))
    .setThumbnail(LOGO_URL || null)
    .setFooter({ text: "Niro Market Purchase System • Live stock loaded", iconURL: LOGO_URL || undefined })
    .setTimestamp();
}

function buildPurchaseSummaryEmbed(user, state) {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setAuthor({ name: "Niro Market", iconURL: LOGO_URL || undefined })
    .setTitle("🧾 Purchase Summary")
    .setThumbnail(LOGO_URL || null)
    .setFooter({ text: "Niro Market Purchase Flow", iconURL: LOGO_URL || undefined })
    .setTimestamp();

  const lines = [
    `**Customer:** ${user}`,
    `**Product:** ${state.product ? `${state.product.label} — ${formatEuro(state.product.price)}` : "Not selected"}`,
    `**Available Stock:** ${state.product ? state.product.stock : "Not selected"}`,
    `**Quantity:** ${state.quantity ?? "Not selected"}`,
    `**Total:** ${state.total != null ? formatEuro(state.total) : "Not calculated"}`,
    `**Payment Method:** ${state.paymentMethod ? state.paymentMethod.label : "Not selected"}`,
    `**Channel Status:** ${state.unlocked ? "Unlocked" : "Locked until payment verification"}`
  ];

  embed.setDescription(lines.join("\n"));
  return embed;
}

function buildPurchaseRows(stockItems) {
  const availableItems = stockItems.length ? stockItems : buildFallbackCatalog();

  const productMenu = new StringSelectMenuBuilder()
    .setCustomId("purchase_product")
    .setPlaceholder("Select what you want to buy")
    .addOptions(
      availableItems.slice(0, 25).map((item) => ({
        label: item.label.slice(0, 100),
        description: `${formatEuro(item.price)} • Stock: ${item.stock}`.slice(0, 100),
        value: item.value,
        emoji: item.emoji || undefined
      }))
    );

  const paymentMenu = new StringSelectMenuBuilder()
    .setCustomId("purchase_payment")
    .setPlaceholder("Select payment method")
    .addOptions(
      paymentMethods.map((method) => ({
        label: method.label,
        description: (method.description || "Select payment method").slice(0, 100),
        value: method.value,
        emoji: method.emoji || undefined
      }))
    );

  const quantityButton = new ButtonBuilder()
    .setCustomId("purchase_quantity_button")
    .setLabel("Enter Quantity")
    .setStyle(ButtonStyle.Primary);

  const doneButton = new ButtonBuilder()
    .setCustomId("purchase_done")
    .setLabel("Done")
    .setStyle(ButtonStyle.Success);

  return [
    new ActionRowBuilder().addComponents(productMenu),
    new ActionRowBuilder().addComponents(quantityButton, doneButton),
    new ActionRowBuilder().addComponents(paymentMenu)
  ];
}

async function sendPurchaseFlow(channel, user) {
  const stockItems = await refreshPurchaseStock(channel);
  const state = getPurchaseState(channel.id);

  const introEmbed = buildPurchaseFlowEmbed(user, stockItems);
  const summaryEmbed = buildPurchaseSummaryEmbed(user, state);

  const lockedEmbed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setAuthor({ name: "Niro Market", iconURL: LOGO_URL || undefined })
    .setTitle("🔒 CHANNEL LOCKED")
    .setDescription([
      "**This purchase ticket is locked.**",
      "",
      "Crypto payments require a valid **BTC** or **LTC** TXID.",
      "PayPal payments require a valid **payment screenshot link**.",
      "Something Else unlocks the channel automatically.",
      "",
      "The channel will unlock only after the required payment proof is verified."
    ].join("\n"))
    .setThumbnail(LOGO_URL || null)
    .setFooter({ text: "Niro Market Payment Verification", iconURL: LOGO_URL || undefined })
    .setTimestamp();

  await channel.send({
    embeds: [introEmbed, summaryEmbed, lockedEmbed],
    components: buildPurchaseRows(stockItems)
  });
}

async function handlePurchaseProduct(interaction) {
  const state = getPurchaseState(interaction.channelId);
  await refreshPurchaseStock(interaction.channel);

  const product = getLiveCatalogItem(interaction.channelId, interaction.values[0]);

  if (!product) {
    await interaction.reply({ content: "Invalid product selected.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!product.inStock || product.stock <= 0) {
    await interaction.reply({
      content: `**${product.label}** is currently out of stock.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  state.product = product;
  state.submitted = false;

  if (state.quantity) {
    if (state.quantity > product.stock) {
      state.total = null;
      await interaction.reply({
        content: `You selected **${product.label}**, but only **${product.stock}** item(s) are available. Please enter a lower quantity.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    state.total = product.price * state.quantity;
  }

  await interaction.reply({
    content: `Selected product: **${product.label}** for **${formatEuro(product.price)}**.\nCurrent stock: **${product.stock}**`,
    flags: MessageFlags.Ephemeral
  });
}

async function showQuantityModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId("purchase_quantity_modal")
    .setTitle("Enter Quantity");

  const quantityInput = new TextInputBuilder()
    .setCustomId("purchase_quantity_input")
    .setLabel("Type the quantity you want")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Example: 1")
    .setRequired(true);

  const row = new ActionRowBuilder().addComponents(quantityInput);
  modal.addComponents(row);

  await interaction.showModal(modal);
}

async function handlePurchaseQuantityModal(interaction) {
  const state = getPurchaseState(interaction.channelId);
  const rawQty = interaction.fields.getTextInputValue("purchase_quantity_input");
  const quantity = Number(rawQty);

  if (!Number.isInteger(quantity) || quantity <= 0) {
    await interaction.reply({
      content: "Please enter a valid positive whole number.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await refreshPurchaseStock(interaction.channel);

  if (state.product) {
    const freshProduct = getLiveCatalogItem(interaction.channelId, state.product.value);

    if (!freshProduct || !freshProduct.inStock) {
      await interaction.reply({
        content: "This item is now out of stock. Please select another item.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    state.product = freshProduct;

    if (quantity > freshProduct.stock) {
      await interaction.reply({
        content: `We do not have that much stock.\nAvailable stock for **${freshProduct.label}**: **${freshProduct.stock}**`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    state.total = freshProduct.price * quantity;
  }

  state.quantity = quantity;
  state.submitted = false;

  await interaction.reply({
    content: `Selected quantity: **${quantity}x**.`,
    flags: MessageFlags.Ephemeral
  });
}

async function handlePurchasePayment(interaction) {
  const state = getPurchaseState(interaction.channelId);
  const paymentMethod = getPaymentMethod(interaction.values[0]);

  if (!paymentMethod) {
    await interaction.reply({ content: "Invalid payment method selected.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!state.product || !state.quantity) {
    await interaction.reply({
      content: "Please select the product and quantity first.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await refreshPurchaseStock(interaction.channel);
  const freshProduct = getLiveCatalogItem(interaction.channelId, state.product.value);

  if (!freshProduct || !freshProduct.inStock) {
    await interaction.reply({
      content: "This item is now out of stock. Please select another item.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (state.quantity > freshProduct.stock) {
    await interaction.reply({
      content: `We do not have that much stock.\nAvailable stock for **${freshProduct.label}**: **${freshProduct.stock}**`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  state.product = freshProduct;
  state.total = freshProduct.price * state.quantity;

  if (paymentMethod.value === "paypal" && Number(state.total) < 1) {
    await interaction.reply({
      content: "PayPal is only available for orders of at least **€1.00**.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  state.paymentMethod = paymentMethod;
  state.submitted = false;

  await interaction.reply({
    content: `Payment method selected: **${paymentMethod.label}**.`,
    flags: MessageFlags.Ephemeral
  });
}

async function handlePurchaseDone(interaction) {
  const state = getPurchaseState(interaction.channelId);

  if (!state.product || !state.quantity || !state.paymentMethod) {
    await interaction.reply({
      content: "Please select product, quantity, and payment method first.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await refreshPurchaseStock(interaction.channel);

  const freshProduct = getLiveCatalogItem(interaction.channelId, state.product.value);

  if (!freshProduct || !freshProduct.inStock) {
    await interaction.reply({
      content: "This item is now out of stock. Please select another item.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (state.quantity > freshProduct.stock) {
    await interaction.reply({
      content: `We do not have that much stock.\nAvailable stock for **${freshProduct.label}**: **${freshProduct.stock}**`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  state.product = freshProduct;
  state.total = freshProduct.price * state.quantity;
  state.submitted = true;
  state.txAttempts = 0;
  state.cryptoQuotes = {};

  const summaryEmbed = buildPurchaseSummaryEmbed(interaction.user, state);
  const detailsEmbed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setAuthor({ name: "Niro Market", iconURL: LOGO_URL || undefined })
    .setTitle(`💳 ${state.paymentMethod.label} Payment`)
    .setThumbnail(LOGO_URL || null)
    .setTimestamp();

  const extraRows = [];

  if (state.paymentMethod.value === "crypto") {
    const walletLines = [];
    const coins = ["btc", "ltc"];

    for (const coinKey of coins) {
      const wallet = cryptoWallets[coinKey];
      if (!wallet?.address) continue;

      try {
        const quote = await getCryptoQuote(wallet.coinGeckoId, state.total);
        const roundedAmount = Number(quote.cryptoAmount.toFixed(wallet.decimals || 8));

        state.cryptoQuotes[coinKey] = {
          expectedAmount: roundedAmount,
          wallet: wallet.address
        };

        walletLines.push([
          `**${wallet.symbol}:**`,
          `EUR total: **${formatEuro(state.total)}**`,
          `${wallet.symbol} total: **${roundedAmount} ${wallet.symbol}**`,
          `Wallet: \`${wallet.address}\``,
          wallet.network ? `Network: ${wallet.network}` : null,
          quote.isFallback ? "*Using fallback market rate.*" : null
        ].filter(Boolean).join("\n"));
      } catch (error) {
        console.error(`Failed to fetch crypto quote for ${coinKey}:`, error);
      }
    }

    detailsEmbed.setDescription(
      walletLines.length
        ? walletLines.join("\n\n")
        : "Crypto wallets are not configured yet."
    );

    const txidButton = new ButtonBuilder()
      .setCustomId("purchase_submit_txid")
      .setLabel("Submit TXID")
      .setStyle(ButtonStyle.Success);

    extraRows.push(new ActionRowBuilder().addComponents(txidButton));
  } else if (state.paymentMethod.value === "paypal") {
    if (state.total < 1) {
      state.paymentMethod = null;
      state.submitted = false;

      await interaction.reply({
        content: "PayPal is only available for orders of at least **€1.00**. Please choose another payment method.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    detailsEmbed.setDescription([
      "Please send the payment through **PayPal Friends and Family**.",
      `**PayPal email:** ${paypalConfig.email || "NOT_SET"}`,
      `**Amount:** ${formatEuro(state.total)}`,
      "",
      "**After sending the payment, press the button below and submit your screenshot link.**",
      "",
      "**Accepted screenshot links:**",
      "- Direct image links ending in .png, .jpg, .jpeg, .webp, or .gif",
      "- Discord CDN links",
      "- Imgur direct image links",
      "",
      "**Examples:**",
      "- https://cdn.discordapp.com/attachments/.../proof.png",
      "- https://media.discordapp.net/attachments/.../proof.jpg",
      "- https://i.imgur.com/example.png",
      "",
      "**Not accepted:** album links, page links, PayPal activity page links, or non-image links"
    ].join("\n"));

    const screenshotButton = new ButtonBuilder()
      .setCustomId("purchase_submit_screenshot")
      .setLabel("Submit Screenshot")
      .setStyle(ButtonStyle.Success);

    extraRows.push(new ActionRowBuilder().addComponents(screenshotButton));
  } else if (state.paymentMethod.value === "something_else") {
    detailsEmbed.setDescription([
      "**You selected Something Else.**",
      "",
      "**This ticket will be unlocked automatically so you can continue with staff.**"
    ].join("\n"));
  }

  const ownershipNotice = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle("📌 Ownership Confirmation")
    .setDescription([
      "After completing the payment, please **tag ownership** in this ticket.",
      "",
      "Include the required **proof / screenshots** so we can verify your order quickly.",
      "",
      "**Required proof:**",
      "- Payment confirmation screenshot",
      "- Transaction ID / hash (for crypto)",
      "- Any relevant proof based on your payment method"
    ].join("\n"))
    .setTimestamp();

  await interaction.reply({
    embeds: [summaryEmbed, detailsEmbed, ownershipNotice],
    components: extraRows
  });

  if (state.paymentMethod.value === "something_else") {
    await unlockSomethingElseChannel(interaction);
  }
}

async function showTxidModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId("purchase_txid_modal")
    .setTitle("Submit Transaction ID");

  const txidInput = new TextInputBuilder()
    .setCustomId("purchase_txid_input")
    .setLabel("Paste your transaction ID / hash")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("Enter your BTC or LTC txid");

  modal.addComponents(new ActionRowBuilder().addComponents(txidInput));
  await interaction.showModal(modal);
}

async function showScreenshotModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId("purchase_screenshot_modal")
    .setTitle("Submit Payment Screenshot");

  const screenshotInput = new TextInputBuilder()
    .setCustomId("purchase_screenshot_input")
    .setLabel("Paste your screenshot image URL")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("https://...");

  modal.addComponents(new ActionRowBuilder().addComponents(screenshotInput));
  await interaction.showModal(modal);
}

async function unlockPurchaseChannel(interaction, txid) {
  const state = getPurchaseState(interaction.channelId);

  await interaction.channel.permissionOverwrites.edit(interaction.user.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true
  });

  state.unlocked = true;
  state.verifiedTxid = txid;

  const unlockedEmbed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setAuthor({ name: "Niro Market", iconURL: LOGO_URL || undefined })
    .setTitle("🔓 CHANNEL UNLOCKED")
    .setDescription([
      `**${interaction.user.tag}** provided a valid transaction ID.`,
      "",
      `**TXID:** \`${txid}\``
    ].join("\n"))
    .setThumbnail(LOGO_URL || null)
    .setFooter({ text: "Niro Market Payment Verification", iconURL: LOGO_URL || undefined })
    .setTimestamp();

  const unlockMessage = await interaction.channel.send({
    embeds: [unlockedEmbed]
  });

  await unlockMessage.pin().catch(() => {});
}

async function unlockPaypalChannelFromLink(interaction, imageUrl) {
  const state = getPurchaseState(interaction.channelId);

  await interaction.channel.permissionOverwrites.edit(interaction.user.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true
  });

  state.unlocked = true;
  state.paypalScreenshotUrl = imageUrl;

  const unlockedEmbed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setAuthor({ name: "Niro Market", iconURL: LOGO_URL || undefined })
    .setTitle("🔓 CHANNEL UNLOCKED")
    .setDescription([
      `**${interaction.user.tag}** submitted PayPal payment proof.`,
      "",
      "**The payment screenshot has been received and pinned successfully.**"
    ].join("\n"))
    .setImage(imageUrl)
    .setThumbnail(LOGO_URL || null)
    .setFooter({ text: "Niro Market Payment Verification", iconURL: LOGO_URL || undefined })
    .setTimestamp();

  const unlockMessage = await interaction.channel.send({
    embeds: [unlockedEmbed]
  });

  await unlockMessage.pin().catch(() => {});
}

async function unlockSomethingElseChannel(interaction) {
  const state = getPurchaseState(interaction.channelId);

  await interaction.channel.permissionOverwrites.edit(interaction.user.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true
  });

  state.unlocked = true;

  const unlockedEmbed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setAuthor({ name: "Niro Market", iconURL: LOGO_URL || undefined })
    .setTitle("🔓 CHANNEL UNLOCKED")
    .setDescription([
      `**${interaction.user.tag}** selected **Something Else**.`,
      "",
      "**This channel has been unlocked automatically.**"
    ].join("\n"))
    .setThumbnail(LOGO_URL || null)
    .setFooter({ text: "Niro Market Payment Flow", iconURL: LOGO_URL || undefined })
    .setTimestamp();

  const unlockMessage = await interaction.channel.send({
    embeds: [unlockedEmbed]
  });

  await unlockMessage.pin().catch(() => {});
}

async function handleTxidModal(interaction) {
  const state = getPurchaseState(interaction.channelId);

  if (!state.submitted || !state.paymentMethod || state.paymentMethod.value !== "crypto") {
    await interaction.reply({
      content: "You need to complete the crypto order first and press Done.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const txid = interaction.fields.getTextInputValue("purchase_txid_input").trim();

  if (!txid) {
    await interaction.reply({
      content: "Invalid TXID.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  let verified = false;
  let verifiedCoin = null;

  for (const coinKey of ["btc", "ltc"]) {
    const wallet = cryptoWallets[coinKey];
    const storedQuote = state.cryptoQuotes?.[coinKey];

    if (!wallet?.address || !storedQuote?.expectedAmount) continue;

    try {
      const result = await verifyCryptoTransaction({
        coinKey,
        txid,
        expectedWallet: wallet.address,
        expectedAmount: storedQuote.expectedAmount
      });

      if (result.found && result.confirmed && result.amountMatches) {
        verified = true;
        verifiedCoin = wallet.symbol;
        break;
      }
    } catch (error) {
      console.error(`TX verify failed for ${coinKey}:`, error);
    }
  }

  if (verified) {
    await interaction.reply({
      content: `✅ Payment verified successfully with **${verifiedCoin}**. The channel has been unlocked.`,
      flags: MessageFlags.Ephemeral
    });

    const tagText =
      SUPPORT_ROLE_ID && /^\d+$/.test(SUPPORT_ROLE_ID)
        ? `<@&${SUPPORT_ROLE_ID}>`
        : "@owners";

    await unlockPurchaseChannel(interaction, txid);

    await interaction.channel.send({
      content: `✅ Payment verified successfully with **${verifiedCoin}**. ${tagText}`
    });

    return;
  }

  state.txAttempts += 1;
  const attemptsLeft = 3 - state.txAttempts;

  if (state.txAttempts >= 3) {
    await interaction.reply({
      content: "❌ Wrong TXID 3 times. This ticket will now close.",
      flags: MessageFlags.Ephemeral
    });

    setTimeout(async () => {
      try {
        purchaseStates.delete(interaction.channelId);
        await interaction.channel.delete();
      } catch (error) {
        console.error("Failed to delete ticket channel after 3 wrong TXIDs:", error);
      }
    }, 5000);

    return;
  }

  await interaction.reply({
    content: `❌ Payment could not be verified. You have **${attemptsLeft}** attempt${attemptsLeft === 1 ? "" : "s"} left.`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleScreenshotModal(interaction) {
  const state = getPurchaseState(interaction.channelId);

  if (!state.submitted || !state.paymentMethod || state.paymentMethod.value !== "paypal") {
    await interaction.reply({
      content: "You need to complete the PayPal order first and press Done.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (state.total == null || state.total < 1) {
    await interaction.reply({
      content: "PayPal is only available for orders of at least **€1.00**.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const imageUrl = interaction.fields.getTextInputValue("purchase_screenshot_input").trim();

  if (!isValidImageUrl(imageUrl)) {
    await interaction.reply({
      content: "Please submit a valid image URL.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.reply({
    content: "✅ PayPal screenshot received. The channel has been unlocked.",
    flags: MessageFlags.Ephemeral
  });

  await unlockPaypalChannelFromLink(interaction, imageUrl);

  const tagText =
    SUPPORT_ROLE_ID && /^\d+$/.test(SUPPORT_ROLE_ID)
      ? `<@&${SUPPORT_ROLE_ID}>`
      : "@owners";

  await interaction.channel.send({
    content: `✅ PayPal proof submitted successfully. ${tagText}`
  });
}

// -------------------- READY --------------------
client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );

    console.log("Slash commands deployed successfully.");
  } catch (error) {
    console.error("Failed to deploy slash commands:", error);
  }
});

// -------------------- INTERACTIONS --------------------
client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName !== "ticket-setup") return;

      const panelEmbed = buildTicketPanelEmbed();
      const row = buildTicketSelectRow();

      await interaction.channel.send({
        embeds: [panelEmbed],
        components: [row]
      });

      await interaction.reply({
        content: "Ticket panel sent.",
        flags: MessageFlags.Ephemeral
      });

      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "ticket_select") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const selectedValue = interaction.values[0];
      const selectedOption = getTicketOption(selectedValue);

      if (!selectedOption) {
        await interaction.editReply({ content: "Invalid ticket option." });
        return;
      }

      const existingChannel = findOpenTicketByUser(interaction.guild, interaction.user.id);

      if (existingChannel) {
        await interaction.editReply({
          content: `You already have an open ticket: ${existingChannel}`
        });
        return;
      }

      const permissionOverwrites = [
        {
          id: interaction.guild.roles.everyone.id,
          deny: [PermissionsBitField.Flags.ViewChannel]
        },
        {
          id: interaction.user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.ReadMessageHistory
          ],
          deny: selectedValue === "purchase"
            ? [PermissionsBitField.Flags.SendMessages]
            : []
        },
        {
          id: client.user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.ManageChannels,
            PermissionsBitField.Flags.ManageMessages
          ]
        }
      ];

      if (selectedValue !== "purchase") {
        permissionOverwrites[1].allow.push(PermissionsBitField.Flags.SendMessages);
      }

      if (SUPPORT_ROLE_ID && /^\d+$/.test(SUPPORT_ROLE_ID)) {
        permissionOverwrites.push({
          id: SUPPORT_ROLE_ID,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.ManageMessages
          ]
        });
      }

      const ticketChannel = await interaction.guild.channels.create({
        name: `ticket-${normalizeName(selectedOption.label)}-${normalizeName(interaction.user.username)}`,
        type: ChannelType.GuildText,
        parent: TICKETS_CATEGORY_ID || null,
        topic: `ticket-owner:${interaction.user.id} | ticket-type:${selectedValue}`,
        permissionOverwrites
      });

      const ticketEmbed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setAuthor({ name: "Niro Market", iconURL: LOGO_URL || undefined })
        .setTitle(`${selectedOption.emoji || "🎫"} ${selectedOption.label} Ticket`)
        .setDescription([
          "**Thank you for contacting Niro Market Support.**",
          "",
          `**Opened By:** ${interaction.user.tag}`,
          `**Reason:** ${selectedOption.label}`,
          "",
          selectedValue === "purchase"
            ? "**Complete the order flow below. This channel will unlock only after the required payment proof is verified.**"
            : "**Please describe your issue and wait for a staff response.**"
        ].join("\n"))
        .setThumbnail(LOGO_URL || null)
        .setFooter({ text: "Niro Market Ticket System", iconURL: LOGO_URL || undefined })
        .setTimestamp();

      const closeButton = new ButtonBuilder()
        .setCustomId("close_ticket")
        .setLabel("Close Ticket")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Danger);

      const buttons = new ActionRowBuilder().addComponents(closeButton);

      const pingText =
        SUPPORT_ROLE_ID && /^\d+$/.test(SUPPORT_ROLE_ID)
          ? `<@&${SUPPORT_ROLE_ID}> ${interaction.user}`
          : `${interaction.user}`;

      await ticketChannel.send({
        content: pingText,
        embeds: [ticketEmbed],
        components: [buttons]
      });

      if (selectedValue === "purchase") {
        await sendPurchaseFlow(ticketChannel, interaction.user);
      }

      await interaction.editReply({
        content: `Your ticket has been created: ${ticketChannel}`
      });

      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "purchase_product") {
      await handlePurchaseProduct(interaction);
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "purchase_payment") {
      await handlePurchasePayment(interaction);
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId === "purchase_quantity_button") {
        await showQuantityModal(interaction);
        return;
      }

      if (interaction.customId === "purchase_done") {
        await handlePurchaseDone(interaction);
        return;
      }

      if (interaction.customId === "purchase_submit_txid") {
        await showTxidModal(interaction);
        return;
      }

      if (interaction.customId === "purchase_submit_screenshot") {
        await showScreenshotModal(interaction);
        return;
      }

      if (interaction.customId === "close_ticket") {
        await interaction.reply({
          content: "Closing ticket and generating transcript...",
          flags: MessageFlags.Ephemeral
        });

        try {
          const channel = interaction.channel;
          const ownerId = getTicketOwnerIdFromTopic(channel.topic || "");
          const ownerUser = ownerId
            ? await client.users.fetch(ownerId).catch(() => null)
            : null;

          const transcriptAttachment = await createTicketTranscript(channel);

          await sendTranscriptToLogs({
            guild: interaction.guild,
            channel,
            closedBy: interaction.user,
            ownerUser,
            transcriptAttachment
          });

          await sendTranscriptToUserDM(ownerUser, transcriptAttachment);
        } catch (error) {
          console.error("Failed to generate/send transcript:", error);
        }

        purchaseStates.delete(interaction.channelId);

        setTimeout(async () => {
          try {
            await interaction.channel.delete();
          } catch (error) {
            console.error("Failed to delete ticket channel:", error);
          }
        }, 3000);

        return;
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === "purchase_quantity_modal") {
        await handlePurchaseQuantityModal(interaction);
        return;
      }

      if (interaction.customId === "purchase_txid_modal") {
        await handleTxidModal(interaction);
        return;
      }

      if (interaction.customId === "purchase_screenshot_modal") {
        await handleScreenshotModal(interaction);
        return;
      }
    }
  } catch (error) {
    console.error("Interaction error:", error);

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: "An error occurred while processing this action.",
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    } else {
      await interaction.reply({
        content: "An error occurred while processing this action.",
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }
  }
});

// -------------------- LOGIN --------------------
(async () => {
  try {
    console.log("Starting Discord login...");
    console.log("TOKEN exists:", !!TOKEN);
    console.log("TOKEN length:", TOKEN.length);
    console.log("CLIENT_ID:", CLIENT_ID || "missing");
    console.log("GUILD_ID:", GUILD_ID || "missing");

    await client.login(TOKEN);
    console.log("client.login() resolved successfully.");
  } catch (error) {
    console.error("Discord login failed:", error);
  }
})();
