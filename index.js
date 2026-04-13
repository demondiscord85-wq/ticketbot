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
  TextInputStyle
} = require("discord.js");

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
const TICKET_PANEL = config.ticketPanel || {
  title: "Welcome to Niro Market",
  description: "Select a category below to open a ticket."
};

const ticketOptions = config.ticketOptions || [];
const purchaseCatalog = config.purchaseCatalog || [];
const paymentMethods = config.paymentMethods || [];
const cryptoWallets = config.cryptoWallets || {};
const paypalConfig = config.paypal || {};
const qrPayment = config.qrPayment || {};

const purchaseStates = new Map();

const commands = [
  new SlashCommandBuilder()
    .setName("ticket-setup")
    .setDescription("Send the Niro Market ticket panel")
    .toJSON()
];

function normalizeName(str) {
  return str
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "")
    .slice(0, 20);
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

function getCatalogItem(value) {
  return purchaseCatalog.find((item) => item.value === value);
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
      cryptoQuotes: {}
    });
  }

  return purchaseStates.get(channelId);
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

async function verifyCryptoTransaction({ coinKey, txid, expectedWallet, expectedAmount }) {
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

function buildPurchaseFlowEmbed(user) {
  const productLines = purchaseCatalog.map(
    (item, index) => `**${index + 1}. ${item.label}** — ${formatEuro(item.price)}`
  );

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
      "4. Press Done"
    ].join("\n"))
    .setThumbnail(LOGO_URL || null)
    .setFooter({ text: "Niro Market Purchase System", iconURL: LOGO_URL || undefined })
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
    `**Quantity:** ${state.quantity ?? "Not selected"}`,
    `**Total:** ${state.total != null ? formatEuro(state.total) : "Not calculated"}`,
    `**Payment Method:** ${state.paymentMethod ? state.paymentMethod.label : "Not selected"}`
  ];

  embed.setDescription(lines.join("\n"));
  return embed;
}

function buildPurchaseRows() {
  const productMenu = new StringSelectMenuBuilder()
    .setCustomId("purchase_product")
    .setPlaceholder("Select what you want to buy")
    .addOptions(
      purchaseCatalog.map((item) => ({
        label: item.label,
        description: `${formatEuro(item.price)}${item.description ? ` • ${item.description}` : ""}`.slice(0, 100),
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
  const state = getPurchaseState(channel.id);
  const introEmbed = buildPurchaseFlowEmbed(user);
  const summaryEmbed = buildPurchaseSummaryEmbed(user, state);

  await channel.send({
    embeds: [introEmbed, summaryEmbed],
    components: buildPurchaseRows()
  });
}

async function handlePurchaseProduct(interaction) {
  const state = getPurchaseState(interaction.channelId);
  const product = getCatalogItem(interaction.values[0]);

  if (!product) {
    await interaction.reply({ content: "Invalid product selected.", ephemeral: true });
    return;
  }

  state.product = product;
  state.submitted = false;

  if (state.quantity) {
    state.total = product.price * state.quantity;
  }

  await interaction.reply({
    content: `Selected product: **${product.label}** for **${formatEuro(product.price)}**.`,
    ephemeral: true
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
      ephemeral: true
    });
    return;
  }

  state.quantity = quantity;
  state.submitted = false;

  if (state.product) {
    state.total = state.product.price * quantity;
  }

  await interaction.reply({
    content: `Selected quantity: **${quantity}x**.`,
    ephemeral: true
  });
}

async function handlePurchasePayment(interaction) {
  const state = getPurchaseState(interaction.channelId);
  const paymentMethod = getPaymentMethod(interaction.values[0]);

  if (!paymentMethod) {
    await interaction.reply({ content: "Invalid payment method selected.", ephemeral: true });
    return;
  }

  state.paymentMethod = paymentMethod;
  state.submitted = false;

  if (!state.product || !state.quantity || state.total == null) {
    await interaction.reply({
      content: "Please select the product and quantity first.",
      ephemeral: true
    });
    return;
  }

  await interaction.reply({
    content: `Payment method selected: **${paymentMethod.label}**.`,
    ephemeral: true
  });
}

async function handlePurchaseDone(interaction) {
  const state = getPurchaseState(interaction.channelId);

  if (!state.product || !state.quantity || !state.paymentMethod) {
    await interaction.reply({
      content: "Please select product, quantity, and payment method first.",
      ephemeral: true
    });
    return;
  }

  state.total = state.product.price * state.quantity;
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
        walletLines.push([
          `**${wallet.symbol}:**`,
          `EUR total: **${formatEuro(state.total)}**`,
          `${wallet.symbol} total: **Unable to calculate right now**`,
          `Wallet: \`${wallet.address}\``,
          wallet.network ? `Network: ${wallet.network}` : null
        ].filter(Boolean).join("\n"));
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
    detailsEmbed.setDescription([
      "Please send the payment through **PayPal Friends and Family**.",
      `**PayPal email:** ${paypalConfig.email || "NOT_SET"}`,
      `**Amount:** ${formatEuro(state.total)}`
    ].join("\n"));
  } else if (state.paymentMethod.value === "qr") {
    const qrLines = [
      qrPayment.text || "Scan one of the QR codes below and send the exact amount.",
      `**Amount:** ${formatEuro(state.total)}`
    ];

    if (Array.isArray(qrPayment.imageUrls) && qrPayment.imageUrls.length) {
      qrLines.push("", ...qrPayment.imageUrls.filter(Boolean));
    }

    detailsEmbed.setDescription(qrLines.join("\n"));
  } else if (state.paymentMethod.value === "something_else") {
    detailsEmbed.setDescription("Wait for the owner to reply.");
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
    components: extraRows,
    ephemeral: false
  });
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

async function handleTxidModal(interaction) {
  const state = getPurchaseState(interaction.channelId);

  if (!state.submitted || !state.paymentMethod || state.paymentMethod.value !== "crypto") {
    await interaction.reply({
      content: "You need to complete the crypto order first and press Done.",
      ephemeral: true
    });
    return;
  }

  const txid = interaction.fields.getTextInputValue("purchase_txid_input").trim();

  if (!txid) {
    await interaction.reply({
      content: "Invalid TXID.",
      ephemeral: true
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
      content: `✅ Payment verified successfully with **${verifiedCoin}**.`,
      ephemeral: true
    });

    const tagText =
      SUPPORT_ROLE_ID && /^\d+$/.test(SUPPORT_ROLE_ID)
        ? `<@&${SUPPORT_ROLE_ID}>`
        : "@owners";

    await interaction.channel.send({
      content: `✅ Payment verified successfully. ${tagText}`
    });

    return;
  }

  state.txAttempts += 1;
  const attemptsLeft = 3 - state.txAttempts;

  if (state.txAttempts >= 3) {
    await interaction.reply({
      content: "❌ Wrong TXID 3 times. This ticket will now close.",
      ephemeral: true
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
    ephemeral: true
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
        ephemeral: true
      });

      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "ticket_select") {
      await interaction.deferReply({ ephemeral: true });

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
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory
          ]
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
            ? "**Complete the order flow below.**"
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

      if (interaction.customId === "close_ticket") {
        await interaction.reply({
          content: "This ticket will close in 5 seconds.",
          ephemeral: true
        });

        purchaseStates.delete(interaction.channelId);

        setTimeout(async () => {
          try {
            await interaction.channel.delete();
          } catch (error) {
            console.error("Failed to delete ticket channel:", error);
          }
        }, 5000);

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
    }
  } catch (error) {
    console.error("Interaction error:", error);

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: "An error occurred while processing this action.",
        ephemeral: true
      }).catch(() => {});
    } else {
      await interaction.reply({
        content: "An error occurred while processing this action.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

// -------------------- DISCORD API TEST + LOGIN --------------------
async function testDiscordApi() {
  try {
    const meRes = await fetch("https://discord.com/api/v10/users/@me", {
      headers: {
        Authorization: `Bot ${TOKEN}`
      }
    });

    console.log("REST /users/@me status:", meRes.status);

    const meText = await meRes.text();
    console.log("REST /users/@me body:", meText.slice(0, 300));

    const gwRes = await fetch("https://discord.com/api/v10/gateway/bot", {
      headers: {
        Authorization: `Bot ${TOKEN}`
      }
    });

    console.log("REST /gateway/bot status:", gwRes.status);

    const gwText = await gwRes.text();
    console.log("REST /gateway/bot body:", gwText.slice(0, 300));
  } catch (err) {
    console.error("Discord REST preflight failed:", err);
  }
}

(async () => {
  try {
    console.log("Starting Discord login...");
    console.log("TOKEN exists:", !!TOKEN);
    console.log("TOKEN length:", TOKEN.length);
    console.log("CLIENT_ID:", CLIENT_ID || "missing");
    console.log("GUILD_ID:", GUILD_ID || "missing");

    await testDiscordApi();

    await client.login(TOKEN);
    console.log("client.login() resolved successfully.");
  } catch (error) {
    console.error("Discord login failed:", error);
  }
})();
