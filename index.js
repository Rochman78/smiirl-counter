const express = require("express");
const app = express();
app.use(express.json());

// ============================================================
// UTILS
// ============================================================

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

async function fetchWithRetry(url, options) {
  try {
    var response = await fetch(url, options);
    if (response.status === 429) {
      console.log("Rate limited Amazon - utilisation du cache");
      return null;
    }
    return response;
  } catch (error) {
    console.error("Fetch error: " + error.message);
    return null;
  }
}

function getParisHour() {
  var now = new Date();
  var paris = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
  return paris.getHours();
}

function getParisMinute() {
  var now = new Date();
  var paris = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
  return paris.getMinutes();
}

function getParisDay() {
  var now = new Date();
  var paris = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
  return paris.getDay();
}

// ============================================================
// MESSAGES MOTIVATION ALEATOIRES
// ============================================================

var MOTIVATION_MESSAGES = [
  "Ca envoie du lourd !",
  "La machine est lancee !",
  "Les ventes pleuvent !",
  "Inarretable !",
  "On lache rien !",
  "Le compteur s'affole !",
  "Encore une ! Continue comme ca !",
  "Business is booming !",
  "Chef, ca tourne !",
  "Money money money !",
  "La caisse enregistreuse chauffe !",
  "Une de plus dans la besace !",
  "Le talent ne ment pas !",
  "Ding ding ding ! Jackpot !",
  "T'es on fire aujourd'hui !",
  "Ca ne s'arrete plus !",
  "Le business tourne a plein regime !",
  "Unstoppable !",
  "Les clients adorent !",
  "Quelle journee de malade !"
];

function getMotivation() {
  return MOTIVATION_MESSAGES[Math.floor(Math.random() * MOTIVATION_MESSAGES.length)];
}

// ============================================================
// MILESTONES
// ============================================================

var milestonesOrdersSent = {};
var milestonesRevenueSent = {};

var ORDER_MILESTONES = [10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000];
var REVENUE_MILESTONES = [1000, 2500, 5000, 7500, 10000, 15000, 20000, 25000, 30000, 40000, 50000, 75000, 100000];

async function checkMilestones(stats) {
  for (var i = 0; i < ORDER_MILESTONES.length; i++) {
    var m = ORDER_MILESTONES[i];
    if (stats._totalOrders >= m && !milestonesOrdersSent[m]) {
      milestonesOrdersSent[m] = true;
      var msg = "\uD83C\uDF89 <b>MILESTONE !</b>\n\n" +
        "\uD83D\uDCE6 <b>" + m + "eme commande du jour !</b>\n" +
        "\uD83D\uDCB0 CA : " + formatMoney(stats._totalRevenue) + " \u20ac\n\n" +
        "On continue ! \uD83D\uDE80";
      await sendTelegram(msg, null);
    }
  }
  for (var j = 0; j < REVENUE_MILESTONES.length; j++) {
    var r = REVENUE_MILESTONES[j];
    if (stats._totalRevenue >= r && !milestonesRevenueSent[r]) {
      milestonesRevenueSent[r] = true;
      var rMsg = "\uD83C\uDF89 <b>MILESTONE !</b>\n\n" +
        "\uD83D\uDCB0 <b>" + formatMoney(r) + " \u20ac atteints aujourd'hui !</b>\n" +
        "\uD83D\uDCE6 " + stats._totalOrders + " commandes\n\n" +
        "Enorme ! \uD83D\uDCAA";
      await sendTelegram(rMsg, null);
    }
  }
}

// ============================================================
// STREAK OBJECTIF
// ============================================================

var streakDays = 0;
var lastStreakDate = "";

function updateStreak(todayReached) {
  var now = new Date();
  var paris = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
  var todayStr = paris.getFullYear() + "-" + String(paris.getMonth() + 1).padStart(2, "0") + "-" + String(paris.getDate()).padStart(2, "0");
  if (todayStr === lastStreakDate) return streakDays;
  if (todayReached) {
    var yesterday = new Date(paris);
    yesterday.setDate(yesterday.getDate() - 1);
    var yesterdayStr = yesterday.getFullYear() + "-" + String(yesterday.getMonth() + 1).padStart(2, "0") + "-" + String(yesterday.getDate()).padStart(2, "0");
    if (lastStreakDate === yesterdayStr) {
      streakDays += 1;
    } else {
      streakDays = 1;
    }
    lastStreakDate = todayStr;
  }
  return streakDays;
}

var MARKETPLACE_MAP = {
  "A13V1IB3VIYZZH": { flag: "\uD83C\uDDEB\uD83C\uDDF7", name: "FR" },
  "A1PA6795UKMFR9": { flag: "\uD83C\uDDE9\uD83C\uDDEA", name: "DE" },
  "A1RKKUPIHCS9HS": { flag: "\uD83C\uDDEA\uD83C\uDDF8", name: "ES" },
  "APJ6JRA9NG5V4": { flag: "\uD83C\uDDEE\uD83C\uDDF9", name: "IT" },
  "A1F83G8C2ARO7P": { flag: "\uD83C\uDDEC\uD83C\uDDE7", name: "UK" },
  "A1805IZSGTT6HS": { flag: "\uD83C\uDDF3\uD83C\uDDF1", name: "NL" },
  "AMEN7PMS3EDWL": { flag: "\uD83C\uDDE7\uD83C\uDDEA", name: "BE" },
  "A2NODRKZP88ZB9": { flag: "\uD83C\uDDF8\uD83C\uDDEA", name: "SE" },
  "A1C3SOZRARQ6R3": { flag: "\uD83C\uDDF5\uD83C\uDDF1", name: "PL" }
};

// ============================================================
// OBJECTIF GOOGLE SHEET
// ============================================================

var cachedObjectif = 0;
var lastObjectifFetch = 0;

async function getObjectif() {
  var now = Date.now();
  if (now - lastObjectifFetch < 10 * 60 * 1000 && cachedObjectif > 0) { return cachedObjectif; }
  var url = process.env.OBJECTIF_SHEET_URL;
  if (!url) return 0;
  try {
    var response = await fetch(url);
    if (!response.ok) return cachedObjectif;
    var text = await response.text();
    var lines = text.trim().split("\n");
    if (lines.length >= 1) {
      var sep = lines[0].indexOf(";") >= 0 ? ";" : ",";
      var parts = lines[0].split(sep);
      var raw = (parts[1] || "").replace(/[^0-9.,]/g, "").replace(",", ".");
      var val = parseFloat(raw);
      if (!isNaN(val) && val > 0) {
        cachedObjectif = val;
        lastObjectifFetch = now;
      }
    }
    return cachedObjectif;
  } catch (error) {
    console.error("Erreur objectif sheet: " + error.message);
    return cachedObjectif;
  }
}

function buildProgressBar(current, target) {
  if (target <= 0) return "";
  var pct = Math.min((current / target) * 100, 100);
  var filled = Math.round(pct / 10);
  var empty = 10 - filled;
  var bar = "";
  for (var i = 0; i < filled; i++) bar += "\u2588";
  for (var j = 0; j < empty; j++) bar += "\u2591";
  return bar + " " + pct.toFixed(0) + "%";
}

var cachedSkuNames = {};
var lastSkuNamesFetch = 0;

async function getSkuNames() {
  var now = Date.now();
  if (now - lastSkuNamesFetch < 30 * 60 * 1000 && Object.keys(cachedSkuNames).length > 0) { return cachedSkuNames; }
  var url = process.env.SKU_NAMES_SHEET_URL;
  if (!url) return cachedSkuNames;
  try {
    var response = await fetch(url);
    if (!response.ok) return cachedSkuNames;
    var text = await response.text();
    var lines = text.trim().split("\n");
    var sep = lines[0].indexOf(";") >= 0 ? ";" : ",";
    var map = {};
    for (var i = 0; i < lines.length; i++) {
      var parts = lines[i].split(sep);
      var sku = (parts[0] || "").trim();
      var name = (parts[1] || "").trim();
      if (sku && name) { map[sku] = name; }
    }
    cachedSkuNames = map;
    lastSkuNamesFetch = now;
    return cachedSkuNames;
  } catch (error) {
    console.error("Erreur SKU names sheet: " + error.message);
    return cachedSkuNames;
  }
}

// ============================================================
// TELEGRAM
// ============================================================

var TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
var TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTelegram(message, buttons) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    var body = { chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: "HTML" };
    if (buttons) { body.reply_markup = JSON.stringify({ inline_keyboard: buttons }); }
    await fetch("https://api.telegram.org/bot" + TELEGRAM_TOKEN + "/sendMessage", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
  } catch (error) { console.error("Erreur Telegram: " + error.message); }
}

async function answerCallback(callbackId) {
  try {
    await fetch("https://api.telegram.org/bot" + TELEGRAM_TOKEN + "/answerCallbackQuery", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackId })
    });
  } catch (error) {}
}

async function editMessage(chatId, messageId, text, buttons) {
  try {
    var body = { chat_id: chatId, message_id: messageId, text: text, parse_mode: "HTML" };
    if (buttons) { body.reply_markup = JSON.stringify({ inline_keyboard: buttons }); }
    await fetch("https://api.telegram.org/bot" + TELEGRAM_TOKEN + "/editMessageText", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
  } catch (error) { console.error("Erreur edit message: " + error.message); }
}

// ============================================================
// SHOPIFY
// ============================================================

function getShops() {
  var shops = [];
  for (var i = 1; i <= 20; i++) {
    var domain = process.env["SHOP_" + i];
    var clientId = process.env["SHOP_" + i + "_CLIENT_ID"];
    var clientSecret = process.env["SHOP_" + i + "_CLIENT_SECRET"];
    var name = process.env["SHOP_" + i + "_NAME"] || domain;
    if (domain && clientId && clientSecret) {
      shops.push({ domain: domain, clientId: clientId, clientSecret: clientSecret, name: name });
    }
  }
  return shops;
}

var shopifyTokenCache = {};

async function getShopifyAccessToken(shop) {
  var now = Date.now();
  var cached = shopifyTokenCache[shop.domain];
  if (cached && now - cached.obtainedAt < 23 * 60 * 60 * 1000) { return cached.token; }
  var url = "https://" + shop.domain + "/admin/oauth/access_token";
  var response = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: shop.clientId, client_secret: shop.clientSecret }),
  });
  if (!response.ok) { console.error("Erreur token Shopify " + shop.domain + ": " + response.status); return null; }
  var data = await response.json();
  shopifyTokenCache[shop.domain] = { token: data.access_token, obtainedAt: now };
  return data.access_token;
}

async function getShopifyOrders(shop, since) {
  var token = await getShopifyAccessToken(shop);
  if (!token) return [];
  var allOrders = [];
  var nextPageUrl = null;
  var isFirstRequest = true;
  while (isFirstRequest || nextPageUrl) {
    isFirstRequest = false;
    var url;
    if (nextPageUrl) { url = nextPageUrl; }
    else {
      url = "https://" + shop.domain + "/admin/api/2024-01/orders.json" +
        "?status=any&financial_status=paid,partially_refunded&created_at_min=" + since +
        "&fields=id,total_price,created_at,name,line_items&limit=250";
    }
    try {
      var response = await fetch(url, { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } });
      if (!response.ok) { console.error("Erreur Shopify " + response.status + " " + shop.domain); break; }
      var data = await response.json();
      var orders = data.orders || [];
      for (var j = 0; j < orders.length; j++) { allOrders.push(orders[j]); }
      var linkHeader = response.headers.get("link");
      nextPageUrl = null;
      if (linkHeader) { var m = linkHeader.match(/<([^>]+)>;\s*rel="next"/); if (m) nextPageUrl = m[1]; }
    } catch (error) { console.error("Erreur Shopify " + shop.domain + ": " + error.message); break; }
  }
  return allOrders;
}

// ============================================================
// AMAZON
// ============================================================

function getAmazonAccounts() {
  var accounts = [];
  for (var i = 1; i <= 10; i++) {
    var clientId = process.env["AMAZON_" + i + "_CLIENT_ID"];
    var clientSecret = process.env["AMAZON_" + i + "_CLIENT_SECRET"];
    var refreshToken = process.env["AMAZON_" + i + "_REFRESH_TOKEN"];
    var marketplace = process.env["AMAZON_" + i + "_MARKETPLACE"] || "A13V1IB3VIYZZH";
    var endpoint = process.env["AMAZON_" + i + "_ENDPOINT"] || "https://sellingpartnerapi-eu.amazon.com";
    var name = process.env["AMAZON_" + i + "_NAME"] || "Amazon " + i;
    if (clientId && clientSecret && refreshToken) {
      accounts.push({ name: name, clientId: clientId, clientSecret: clientSecret, refreshToken: refreshToken, marketplace: marketplace, endpoint: endpoint });
    }
  }
  return accounts;
}

var amazonTokenCache = {};

async function getAmazonAccessToken(account) {
  var now = Date.now();
  var cacheKey = account.clientId;
  var cached = amazonTokenCache[cacheKey];
  if (cached && now - cached.obtainedAt < 50 * 60 * 1000) { return cached.token; }
  var response = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=refresh_token&client_id=" + encodeURIComponent(account.clientId) + "&client_secret=" + encodeURIComponent(account.clientSecret) + "&refresh_token=" + encodeURIComponent(account.refreshToken),
  });
  if (!response.ok) { console.error("Erreur token Amazon " + account.name + ": " + response.status); return null; }
  var data = await response.json();
  amazonTokenCache[cacheKey] = { token: data.access_token, obtainedAt: now };
  return data.access_token;
}

var amazonOrdersCache = {};
var amazonFetchLock = false;

async function fetchAmazonOrdersRaw(account, since) {
  var token = await getAmazonAccessToken(account);
  if (!token) return [];
  var allOrders = [];
  var nextToken = null;
  var isFirstRequest = true;
  while (isFirstRequest || nextToken) {
    isFirstRequest = false;
    var url = account.endpoint + "/orders/v0/orders?MarketplaceIds=" + account.marketplace +
      "&CreatedAfter=" + encodeURIComponent(since) + "&OrderStatuses=Shipped,Unshipped&MaxResultsPerPage=100";
    if (nextToken) { url += "&NextToken=" + encodeURIComponent(nextToken); }
    var response = await fetchWithRetry(url, { headers: { "x-amz-access-token": token, "Content-Type": "application/json" } });
    if (!response || !response.ok) { console.error("Erreur Amazon " + (response ? response.status : "timeout") + " " + account.name); break; }
    var data = await response.json();
    var orders = data.payload && data.payload.Orders ? data.payload.Orders : [];
    for (var j = 0; j < orders.length; j++) { allOrders.push(orders[j]); }
    nextToken = data.payload && data.payload.NextToken ? data.payload.NextToken : null;
    if (nextToken) await sleep(2000);
  }
  return allOrders;
}

async function getAmazonOrdersCached(account, since, cacheKey, cacheDuration) {
  var now = Date.now();
  var cached = amazonOrdersCache[cacheKey];
  if (cached && now - cached.time < cacheDuration) { return cached.orders; }
  if (amazonFetchLock) {
    if (cached) return cached.orders;
    return [];
  }
  amazonFetchLock = true;
  try {
    var orders = await fetchAmazonOrdersRaw(account, since);
    amazonOrdersCache[cacheKey] = { orders: orders, time: now };
    return orders;
  } finally { amazonFetchLock = false; }
}

function filterOrdersByMarketplace(orders, marketplaceId) {
  var filtered = [];
  for (var i = 0; i < orders.length; i++) {
    if (orders[i].MarketplaceId === marketplaceId) { filtered.push(orders[i]); }
  }
  return filtered;
}

// ============================================================
// HELPERS
// ============================================================

function formatMoney(amount) {
  return Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function getPeriodDates(period) {
  var now = new Date();
  var paris = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
  var start, end;
  if (period === "d") { start = new Date(paris.getFullYear(), paris.getMonth(), paris.getDate()); end = now; }
  else if (period === "h") { start = new Date(paris.getFullYear(), paris.getMonth(), paris.getDate() - 1); end = new Date(paris.getFullYear(), paris.getMonth(), paris.getDate()); }
  else if (period === "m") { start = new Date(paris.getFullYear(), paris.getMonth(), 1); end = now; }
  else if (period === "a") { start = new Date(paris.getFullYear(), 0, 1); end = now; }
  else { start = new Date(2020, 0, 1); end = now; }
  return { start: start.toISOString(), end: end.toISOString() };
}

function getPeriodLabel(period) {
  if (period === "d") return "Aujourd'hui";
  if (period === "h") return "Hier";
  if (period === "m") return "Ce mois";
  if (period === "a") return "Cette annee";
  return "Total";
}

function getAmazonRevenue(orders) {
  var total = 0;
  for (var i = 0; i < orders.length; i++) {
    if (orders[i].OrderTotal && orders[i].OrderTotal.Amount) { total += parseFloat(orders[i].OrderTotal.Amount); }
  }
  return total;
}

var JOUR_NAMES = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
var MOIS_NAMES = ["Janvier", "Fevrier", "Mars", "Avril", "Mai", "Juin", "Juillet", "Aout", "Septembre", "Octobre", "Novembre", "Decembre"];

async function getStatsForShop(shopName, period, marketplaceId) {
  var dates = getPeriodDates(period);
  var shops = getShops();
  var amazonAccounts = getAmazonAccounts();
  var revenue = 0;
  var orderCount = 0;

  if (shopName === "ALL_AMAZON") {
    for (var a = 0; a < amazonAccounts.length; a++) {
      var allAmzOrders = await getAmazonOrdersCached(amazonAccounts[a], dates.start, "stats_amazon_" + period, 5 * 60 * 1000);
      revenue += getAmazonRevenue(allAmzOrders);
      orderCount += allAmzOrders.length;
    }
    return { revenue: revenue, orders: orderCount };
  }

  if (marketplaceId) {
    for (var b = 0; b < amazonAccounts.length; b++) {
      var amzOrdersAll = await getAmazonOrdersCached(amazonAccounts[b], dates.start, "stats_amazon_" + period, 5 * 60 * 1000);
      var filtered = filterOrdersByMarketplace(amzOrdersAll, marketplaceId);
      revenue += getAmazonRevenue(filtered);
      orderCount += filtered.length;
    }
    return { revenue: revenue, orders: orderCount };
  }

  for (var i = 0; i < shops.length; i++) {
    if (shops[i].name === shopName) {
      var orders = await getShopifyOrders(shops[i], dates.start);
      for (var j = 0; j < orders.length; j++) {
        var created = new Date(orders[j].created_at);
        if (created <= new Date(dates.end)) {
          revenue += parseFloat(orders[j].total_price || 0);
          orderCount += 1;
        }
      }
    }
  }

  return { revenue: revenue, orders: orderCount };
}

async function getStatsForAll(period) {
  var dates = getPeriodDates(period);
  var shops = getShops();
  var amazonAccounts = getAmazonAccounts();
  var revenue = 0;
  var orderCount = 0;

  for (var i = 0; i < shops.length; i++) {
    var orders = await getShopifyOrders(shops[i], dates.start);
    for (var j = 0; j < orders.length; j++) {
      var created = new Date(orders[j].created_at);
      if (created <= new Date(dates.end)) {
        revenue += parseFloat(orders[j].total_price || 0);
        orderCount += 1;
      }
    }
  }

  for (var k = 0; k < amazonAccounts.length; k++) {
    var amzOrders = await getAmazonOrdersCached(amazonAccounts[k], dates.start, "stats_all_amazon_" + period, 5 * 60 * 1000);
    revenue += getAmazonRevenue(amzOrders);
    orderCount += amzOrders.length;
  }

  return { revenue: revenue, orders: orderCount };
}

// ============================================================
// BOUTONS
// ============================================================

function getMainButtons() {
  return [
    [
      { text: "\uD83D\uDCB8 Ventes", callback_data: "menu_ventes" },
      { text: "\uD83C\uDFC6 Top Produits", callback_data: "tp_menu" }
    ]
  ];
}

function getShopButtons() {
  var shops = getShops();
  var buttons = [];
  var row = [];
  for (var i = 0; i < shops.length; i++) {
    row.push({ text: shops[i].name, callback_data: "s:" + shops[i].name });
    if (row.length === 4) { buttons.push(row); row = []; }
  }
  if (row.length > 0) { buttons.push(row); row = []; }
  buttons.push([{ text: "\uD83D\uDCE6 Amazon EU", callback_data: "amz_menu" }]);
  buttons.push([{ text: "\uD83C\uDF0D ALL", callback_data: "s:ALL" }]);
  buttons.push([{ text: "\u2B05\uFE0F Retour", callback_data: "main_menu" }]);
  return buttons;
}

function getAmazonCountryButtons() {
  var keys = Object.keys(MARKETPLACE_MAP);
  var buttons = [];
  var row = [];
  for (var i = 0; i < keys.length; i++) {
    var mp = MARKETPLACE_MAP[keys[i]];
    row.push({ text: mp.flag + " " + mp.name, callback_data: "amz:" + keys[i] });
    if (row.length === 3) { buttons.push(row); row = []; }
  }
  if (row.length > 0) buttons.push(row);
  buttons.push([{ text: "\uD83D\uDCE6 ALL AMAZON", callback_data: "s:ALL_AMAZON" }]);
  buttons.push([{ text: "\u2B05\uFE0F Retour", callback_data: "menu_ventes" }]);
  return buttons;
}

function getPeriodButtons(shopName) {
  return [
    [
      { text: "\uD83D\uDCC5 Aujourd'hui", callback_data: "p:" + shopName + ":d" },
      { text: "\u23EA Hier", callback_data: "p:" + shopName + ":h" }
    ],
    [
      { text: "\uD83D\uDCC6 Ce mois", callback_data: "p:" + shopName + ":m" },
      { text: "\uD83D\uDCCA Cette annee", callback_data: "p:" + shopName + ":a" }
    ],
    [
      { text: "\u2B05\uFE0F Retour", callback_data: "menu_ventes" }
    ]
  ];
}

function getAmzPeriodButtons(marketplaceId) {
  return [
    [
      { text: "\uD83D\uDCC5 Aujourd'hui", callback_data: "ap:" + marketplaceId + ":d" },
      { text: "\u23EA Hier", callback_data: "ap:" + marketplaceId + ":h" }
    ],
    [
      { text: "\uD83D\uDCC6 Ce mois", callback_data: "ap:" + marketplaceId + ":m" },
      { text: "\uD83D\uDCCA Cette annee", callback_data: "ap:" + marketplaceId + ":a" }
    ],
    [
      { text: "\u2B05\uFE0F Retour pays", callback_data: "amz_menu" },
      { text: "\u2B05\uFE0F Retour", callback_data: "menu_ventes" }
    ]
  ];
}

// ============================================================
// NOTIFICATIONS
// ============================================================

var knownOrderIds = {};
var dailyShopStats = {};
var firstRun = true;
var objectifAlertSent = false;

function getTodayKey() {
  var now = new Date();
  var paris = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
  return paris.getFullYear() + "-" + String(paris.getMonth() + 1).padStart(2, "0") + "-" + String(paris.getDate()).padStart(2, "0");
}

function resetDailyStatsIfNeeded() {
  var today = getTodayKey();
  if (!dailyShopStats._date || dailyShopStats._date !== today) {
    dailyShopStats = { _date: today, _totalRevenue: 0, _totalOrders: 0 };
    objectifAlertSent = false;
    milestonesOrdersSent = {};
    milestonesRevenueSent = {};
  }
  return dailyShopStats;
}

function addToShopStats(shopName, amount) {
  var stats = resetDailyStatsIfNeeded();
  if (!stats[shopName]) { stats[shopName] = { revenue: 0, orders: 0 }; }
  stats[shopName].revenue += amount;
  stats[shopName].orders += 1;
  stats._totalRevenue += amount;
  stats._totalOrders += 1;
}

function buildTopBoutiques() {
  var stats = resetDailyStatsIfNeeded();
  var shops = [];
  var keys = Object.keys(stats);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].charAt(0) === "_") continue;
    var s = stats[keys[i]];
    if (s.revenue > 0) { shops.push({ name: keys[i], revenue: s.revenue, orders: s.orders }); }
  }
  shops.sort(function(a, b) { return b.revenue - a.revenue; });
  var medals = ["\uD83E\uDD47", "\uD83E\uDD48", "\uD83E\uDD49"];
  var lines = [];
  for (var j = 0; j < shops.length; j++) {
    var medal = j < 3 ? medals[j] : "   ";
    var pct = stats._totalRevenue > 0 ? ((shops[j].revenue / stats._totalRevenue) * 100).toFixed(1) : "0";
    var avg = shops[j].orders > 0 ? Math.round(shops[j].revenue / shops[j].orders) : 0;
    lines.push(medal + " <b>" + shops[j].name + "</b>\n     \uD83D\uDCB0 " + formatMoney(shops[j].revenue) + " \u20ac (" + pct + "%)\n     \uD83D\uDED2 " + shops[j].orders + " cmd \u00b7 \u00d8 " + formatMoney(avg) + " \u20ac");
  }
  return lines.join("\n\n");
}

async function buildRecapMessage() {
  var stats = resetDailyStatsIfNeeded();
  var top = buildTopBoutiques();
  var objectif = await getObjectif();
  var progressLine = "";
  if (objectif > 0) {
    var bar = buildProgressBar(stats._totalRevenue, objectif);
    progressLine = "\n\n\uD83C\uDFAF <b>Objectif : " + formatMoney(objectif) + " \u20ac</b>\n" + bar;
    if (streakDays > 1) {
      progressLine += "\n\uD83D\uDD25 <b>Streak : " + streakDays + " jours consecutifs !</b>";
    }
  }
  var globalAvg = stats._totalOrders > 0 ? Math.round(stats._totalRevenue / stats._totalOrders) : 0;
  return "\n\n\uD83D\uDCCA <b>Recap du jour :</b>\n\n" + top +
    "\n\n\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\n" +
    "\uD83D\uDCB0 <b>Total : " + formatMoney(stats._totalRevenue) + " \u20ac (" + stats._totalOrders + " commande" + (stats._totalOrders > 1 ? "s" : "") + ")</b>\n" +
    "\uD83D\uDED2 <b>Panier moyen : " + formatMoney(globalAvg) + " \u20ac</b>" +
    progressLine;
}

async function checkNewOrders() {
  var shops = getShops();
  var amazonAccounts = getAmazonAccounts();
  var now = new Date();
  var paris = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
  var startOfDay = new Date(Date.UTC(paris.getFullYear(), paris.getMonth(), paris.getDate()) - 1 * 60 * 60 * 1000).toISOString();
  resetDailyStatsIfNeeded();
  var grosseCommandeSeuil = parseFloat(process.env.ALERTE_GROSSE_COMMANDE || "1000");

  for (var i = 0; i < shops.length; i++) {
    var shop = shops[i];
    try {
      var orders = await getShopifyOrders(shop, startOfDay);
      for (var j = 0; j < orders.length; j++) {
        var order = orders[j];
        var orderId = "shopify_" + shop.domain + "_" + order.id;
        if (!knownOrderIds[orderId]) {
          knownOrderIds[orderId] = true;
          var amount = parseFloat(order.total_price || 0);
          addToShopStats(shop.name, amount);
          if (!firstRun) {
            var emoji = amount >= grosseCommandeSeuil ? "\uD83D\uDD25\uD83D\uDD25\uD83D\uDD25" : "\uD83D\uDED2";
            var bigLabel = amount >= grosseCommandeSeuil ? "\n\uD83D\uDC8E <b>GROSSE COMMANDE !</b>" : "";
            var recap = await buildRecapMessage();
            var msg = emoji + " <b>Nouvelle commande sur " + shop.name + " !</b>" + bigLabel + "\n\uD83D\uDCB0 Montant : " + formatMoney(amount) + " \u20ac\n\n" + getMotivation() + recap;
            await sendTelegram(msg, getMainButtons());
            await checkObjectifAtteint();
            await checkMilestones(resetDailyStatsIfNeeded());
          }
        }
      }
    } catch (error) { console.error("Erreur check " + shop.name + ": " + error.message); }
  }

  for (var k = 0; k < amazonAccounts.length; k++) {
    var account = amazonAccounts[k];
    try {
      var amzOrders = await getAmazonOrdersCached(account, startOfDay, "scan_" + account.name, 10 * 60 * 1000);
      for (var l = 0; l < amzOrders.length; l++) {
        var amzOrder = amzOrders[l];
        var amzOrderId = "amazon_" + account.name + "_" + amzOrder.AmazonOrderId;
        if (!knownOrderIds[amzOrderId]) {
          knownOrderIds[amzOrderId] = true;
          var amzAmount = 0;
          if (amzOrder.OrderTotal && amzOrder.OrderTotal.Amount) { amzAmount = parseFloat(amzOrder.OrderTotal.Amount); }
          var mpInfo = MARKETPLACE_MAP[amzOrder.MarketplaceId];
          var amzLabel = mpInfo ? mpInfo.flag + " AMZ " + mpInfo.name : account.name;
          addToShopStats(amzLabel, amzAmount);
          if (!firstRun) {
            var amzEmoji = amzAmount >= grosseCommandeSeuil ? "\uD83D\uDD25\uD83D\uDD25\uD83D\uDD25" : "\uD83D\uDCE6";
            var amzBigLabel = amzAmount >= grosseCommandeSeuil ? "\n\uD83D\uDC8E <b>GROSSE COMMANDE !</b>" : "";
            var amzRecap = await buildRecapMessage();
            var amzMsg = amzEmoji + " <b>Nouvelle commande sur " + amzLabel + " !</b>" + amzBigLabel + "\n\uD83D\uDCB0 Montant : " + formatMoney(amzAmount) + " \u20ac\n\n" + getMotivation() + amzRecap;
            await sendTelegram(amzMsg, getMainButtons());
            await checkObjectifAtteint();
            await checkMilestones(resetDailyStatsIfNeeded());
          }
        }
      }
    } catch (error) { console.error("Erreur check " + account.name + ": " + error.message); }
  }

  if (firstRun) {
    firstRun = false;
    var stats = resetDailyStatsIfNeeded();
    console.log("Premier scan: " + stats._totalOrders + " commandes (" + formatMoney(stats._totalRevenue) + " EUR)");
  }
}

async function checkObjectifAtteint() {
  if (objectifAlertSent) return;
  var stats = resetDailyStatsIfNeeded();
  var objectif = await getObjectif();
  if (objectif > 0 && stats._totalRevenue >= objectif) {
    objectifAlertSent = true;
    updateStreak(true);
    var bar = buildProgressBar(stats._totalRevenue, objectif);
    var streakLine = streakDays > 1 ? "\n\uD83D\uDD25 <b>" + streakDays + " jours consecutifs !</b>" : "";
    var msg = "\uD83C\uDFAF\uD83C\uDF89 <b>OBJECTIF DU JOUR ATTEINT !</b>\n\n" +
      "\uD83D\uDCB0 " + formatMoney(stats._totalRevenue) + " \u20ac / " + formatMoney(objectif) + " \u20ac\n" +
      bar + streakLine + "\n\n" +
      "Bravo ! \uD83D\uDE80";
    await sendTelegram(msg, null);
  }
}

setInterval(checkNewOrders, 60 * 1000);

// ============================================================
// RAPPORTS AUTOMATIQUES
// ============================================================

var eveningReportSent = false;
var morningReportSent = false;
var weeklyReportSent = false;

setInterval(async function () {
  var hour = getParisHour();
  var minute = getParisMinute();
  var day = getParisDay();

  // Rapport du matin 8h (sauf lundi = rapport hebdo)
  if (hour === 8 && minute === 0 && !morningReportSent && day !== 1) {
    morningReportSent = true;
    try {
      var yesterdayStats = await getStatsForAll("h");
      var yAvg = yesterdayStats.orders > 0 ? Math.round(yesterdayStats.revenue / yesterdayStats.orders) : 0;
      var objectifMatin = await getObjectif();
      var objectifLine = "";
      if (objectifMatin > 0) {
        objectifLine = "\n\n\uD83C\uDFAF <b>Objectif du jour : " + formatMoney(objectifMatin) + " \u20ac</b>\n\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591 0%";
        if (streakDays > 0) {
          objectifLine += "\n\uD83D\uDD25 Streak en cours : " + streakDays + " jour" + (streakDays > 1 ? "s" : "");
        }
      }
      var morningMsg = "\u2600\uFE0F <b>Bonjour ! Recap d'hier :</b>\n\n" +
        "\uD83D\uDCB0 CA : " + formatMoney(yesterdayStats.revenue) + " \u20ac\n" +
        "\uD83D\uDCE6 Commandes : " + yesterdayStats.orders + "\n" +
        "\uD83D\uDED2 Panier moyen : " + formatMoney(yAvg) + " \u20ac" +
        objectifLine + "\n\n" +
        "Bonne journee ! \uD83D\uDCAA";
      await sendTelegram(morningMsg, getMainButtons());
    } catch (error) { console.error("Erreur rapport matin: " + error.message); }
  }
  if (hour === 8 && minute === 1) { morningReportSent = false; }

  // Rapport du soir 20h
  if (hour === 20 && minute === 0 && !eveningReportSent) {
    eveningReportSent = true;
    var stats = resetDailyStatsIfNeeded();
    if (stats._totalOrders > 0) {
      var recap = await buildRecapMessage();
      var msg = "\uD83C\uDF19 <b>Rapport du soir</b>" + recap;
      await sendTelegram(msg, getMainButtons());
    } else {
      await sendTelegram("\uD83C\uDF19 <b>Rapport du soir</b>\n\nAucune vente aujourd'hui.", null);
    }
  }
  if (hour === 20 && minute === 1) { eveningReportSent = false; }
  if (hour === 0 && minute === 0) { eveningReportSent = false; }

  // Rapport hebdo lundi 8h
  if (day === 1 && hour === 8 && minute === 0 && !weeklyReportSent) {
    weeklyReportSent = true;
    morningReportSent = true;
    try {
      var now = new Date();
      var lastMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      var lastSunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      var weekStart = lastMonday.toISOString();
      var shops = getShops();
      var amazonAccounts = getAmazonAccounts();
      var weekRevenue = 0;
      var weekOrders = 0;
      var shopResults = [];
      var dayRevenues = [0, 0, 0, 0, 0, 0, 0];

      for (var i = 0; i < shops.length; i++) {
        var orders = await getShopifyOrders(shops[i], weekStart);
        var rev = 0;
        var cnt = 0;
        for (var j = 0; j < orders.length; j++) {
          var created = new Date(orders[j].created_at);
          if (created <= lastSunday) {
            var orderRev = parseFloat(orders[j].total_price || 0);
            rev += orderRev;
            cnt += 1;
            dayRevenues[created.getDay()] += orderRev;
          }
        }
        if (rev > 0) { shopResults.push({ name: shops[i].name, revenue: rev, orders: cnt }); }
        weekRevenue += rev;
        weekOrders += cnt;
      }

      for (var k = 0; k < amazonAccounts.length; k++) {
        var amzOrders = await getAmazonOrdersCached(amazonAccounts[k], weekStart, "weekly_report", 10 * 60 * 1000);
        var amzRev = getAmazonRevenue(amzOrders);
        if (amzRev > 0) { shopResults.push({ name: amazonAccounts[k].name, revenue: amzRev, orders: amzOrders.length }); }
        weekRevenue += amzRev;
        weekOrders += amzOrders.length;
      }

      shopResults.sort(function(a, b) { return b.revenue - a.revenue; });
      var medals = ["\uD83E\uDD47", "\uD83E\uDD48", "\uD83E\uDD49"];
      var lines = [];
      for (var m = 0; m < shopResults.length; m++) {
        var medal = m < 3 ? medals[m] : "   ";
        var pct = weekRevenue > 0 ? ((shopResults[m].revenue / weekRevenue) * 100).toFixed(1) : "0";
        var avg = shopResults[m].orders > 0 ? Math.round(shopResults[m].revenue / shopResults[m].orders) : 0;
        lines.push(medal + " <b>" + shopResults[m].name + "</b>\n     \uD83D\uDCB0 " + formatMoney(shopResults[m].revenue) + " \u20ac (" + pct + "%)\n     \uD83D\uDED2 " + shopResults[m].orders + " cmd \u00b7 \u00d8 " + formatMoney(avg) + " \u20ac");
      }

      // Meilleur jour de la semaine
      var bestDayIdx = 0;
      for (var d = 1; d < 7; d++) { if (dayRevenues[d] > dayRevenues[bestDayIdx]) bestDayIdx = d; }
      var bestDayLine = "";
      if (dayRevenues[bestDayIdx] > 0) {
        bestDayLine = "\n\uD83C\uDFC6 <b>Meilleur jour : " + JOUR_NAMES[bestDayIdx] + " (" + formatMoney(dayRevenues[bestDayIdx]) + " \u20ac)</b>";
      }

      var weekAvg = weekOrders > 0 ? Math.round(weekRevenue / weekOrders) : 0;
      var weekMsg = "\uD83D\uDCC5 <b>Rapport hebdomadaire</b>\n\n" +
        lines.join("\n\n") +
        "\n\n\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\n" +
        "\uD83D\uDCB0 <b>Total semaine : " + formatMoney(weekRevenue) + " \u20ac (" + weekOrders + " commande" + (weekOrders > 1 ? "s" : "") + ")</b>\n" +
        "\uD83D\uDED2 <b>Panier moyen : " + formatMoney(weekAvg) + " \u20ac</b>" +
        bestDayLine;
      await sendTelegram(weekMsg, getMainButtons());
    } catch (error) { console.error("Erreur rapport hebdo: " + error.message); }
  }
  if (day === 1 && hour === 8 && minute === 1) { weeklyReportSent = false; }
  if (day !== 1) { weeklyReportSent = false; }

}, 30 * 1000);

// ============================================================
// WEBHOOK TELEGRAM
// ============================================================

app.post("/webhook", async function (req, res) {
  res.json({ ok: true });

  // Commande /mois
  if (req.body && req.body.message && req.body.message.text && req.body.message.text.indexOf("/mois") === 0) {
    var thisMonthStats = await getStatsForAll("m");
    var now = new Date();
    var lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    var lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    var dayOfMonth = now.getDate();
    var shops = getShops();
    var amazonAccounts = getAmazonAccounts();
    var lastMonthRevenue = 0;
    var lastMonthOrders = 0;
    for (var mi = 0; mi < shops.length; mi++) {
      var mOrders = await getShopifyOrders(shops[mi], lastMonthStart.toISOString());
      for (var mj = 0; mj < mOrders.length; mj++) {
        var mCreated = new Date(mOrders[mj].created_at);
        if (mCreated <= lastMonthEnd) {
          lastMonthRevenue += parseFloat(mOrders[mj].total_price || 0);
          lastMonthOrders += 1;
        }
      }
    }
    for (var mk = 0; mk < amazonAccounts.length; mk++) {
      var mAmzOrders = await getAmazonOrdersCached(amazonAccounts[mk], lastMonthStart.toISOString(), "last_month", 10 * 60 * 1000);
      for (var ml = 0; ml < mAmzOrders.length; ml++) {
        var mAmzCreated = new Date(mAmzOrders[ml].PurchaseDate);
        if (mAmzCreated <= lastMonthEnd) {
          if (mAmzOrders[ml].OrderTotal && mAmzOrders[ml].OrderTotal.Amount) {
            lastMonthRevenue += parseFloat(mAmzOrders[ml].OrderTotal.Amount);
          }
          lastMonthOrders += 1;
        }
      }
    }
    var mDiff = thisMonthStats.revenue - lastMonthRevenue;
    var mArrow = mDiff >= 0 ? "\uD83D\uDCC8" : "\uD83D\uDCC9";
    var mSign = mDiff >= 0 ? "+" : "";
    var mPct = lastMonthRevenue > 0 ? ((mDiff / lastMonthRevenue) * 100).toFixed(1) : "N/A";
    var thisAvg = thisMonthStats.orders > 0 ? Math.round(thisMonthStats.revenue / thisMonthStats.orders) : 0;
    var lastAvg = lastMonthOrders > 0 ? Math.round(lastMonthRevenue / lastMonthOrders) : 0;
    var thisMoisName = MOIS_NAMES[now.getMonth()];
    var lastMoisName = MOIS_NAMES[now.getMonth() === 0 ? 11 : now.getMonth() - 1];
    var moisMsg = "\uD83D\uDCC6 <b>Comparaison mensuelle</b>\n\n" +
      "\uD83D\uDCC5 <b>" + thisMoisName + "</b> (J" + dayOfMonth + ")\n" +
      "     \uD83D\uDCB0 " + formatMoney(thisMonthStats.revenue) + " \u20ac\n" +
      "     \uD83D\uDCE6 " + thisMonthStats.orders + " cmd \u00b7 \u00d8 " + formatMoney(thisAvg) + " \u20ac\n\n" +
      "\u23EA <b>" + lastMoisName + "</b> (mois complet)\n" +
      "     \uD83D\uDCB0 " + formatMoney(lastMonthRevenue) + " \u20ac\n" +
      "     \uD83D\uDCE6 " + lastMonthOrders + " cmd \u00b7 \u00d8 " + formatMoney(lastAvg) + " \u20ac\n\n" +
      "\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\n" +
      mArrow + " <b>" + mSign + formatMoney(Math.abs(mDiff)) + " \u20ac (" + mSign + mPct + "%)</b>";
    await sendTelegram(moisMsg, getMainButtons());
    return;
  }

  // Commande /compare
  if (req.body && req.body.message && req.body.message.text && req.body.message.text.indexOf("/compare") === 0) {
    var cHour = getParisHour();
    var cMin = getParisMinute();
    var todayStats = await getStatsForAll("d");
    var yesterdayStats = await getStatsForAll("h");
    var diff = todayStats.revenue - yesterdayStats.revenue;
    var arrow = diff >= 0 ? "\uD83D\uDCC8" : "\uD83D\uDCC9";
    var sign = diff >= 0 ? "+" : "";
    var pctChange = yesterdayStats.revenue > 0 ? ((diff / yesterdayStats.revenue) * 100).toFixed(1) : "N/A";
    var todayAvg = todayStats.orders > 0 ? Math.round(todayStats.revenue / todayStats.orders) : 0;
    var yesterdayAvg = yesterdayStats.orders > 0 ? Math.round(yesterdayStats.revenue / yesterdayStats.orders) : 0;
    var compareMsg = "\uD83D\uDCCA <b>Comparaison</b>\n\n" +
      "\uD83D\uDCC5 <b>Aujourd'hui</b> (a " + cHour + "h" + String(cMin).padStart(2, "0") + ")\n" +
      "     \uD83D\uDCB0 " + formatMoney(todayStats.revenue) + " \u20ac\n" +
      "     \uD83D\uDED2 " + todayStats.orders + " cmd \u00b7 \u00d8 " + formatMoney(todayAvg) + " \u20ac\n\n" +
      "\u23EA <b>Hier (journee complete)</b>\n" +
      "     \uD83D\uDCB0 " + formatMoney(yesterdayStats.revenue) + " \u20ac\n" +
      "     \uD83D\uDED2 " + yesterdayStats.orders + " cmd \u00b7 \u00d8 " + formatMoney(yesterdayAvg) + " \u20ac\n\n" +
      "\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\n" +
      arrow + " <b>" + sign + formatMoney(Math.abs(diff)) + " \u20ac (" + sign + pctChange + "%)</b>";
    await sendTelegram(compareMsg, getMainButtons());
    return;
  }

  // Commande /top
  if (req.body && req.body.message && req.body.message.text && req.body.message.text.trim() === "/top") {
    var topStats = resetDailyStatsIfNeeded();
    if (topStats._totalOrders === 0) {
      await sendTelegram("\uD83C\uDFC6 <b>Top boutiques</b>\n\nAucune vente aujourd'hui.", null);
      return;
    }
    var globalAvgTop = topStats._totalOrders > 0 ? Math.round(topStats._totalRevenue / topStats._totalOrders) : 0;
    var topMsg = "\uD83C\uDFC6 <b>Top boutiques du jour</b>\n\n" + buildTopBoutiques() +
      "\n\n\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\n" +
      "\uD83D\uDCB0 <b>Total : " + formatMoney(topStats._totalRevenue) + " \u20ac (" + topStats._totalOrders + " commande" + (topStats._totalOrders > 1 ? "s" : "") + ")</b>\n" +
      "\uD83D\uDED2 <b>Panier moyen : " + formatMoney(globalAvgTop) + " \u20ac</b>";
    await sendTelegram(topMsg, getMainButtons());
    return;
  }

  // Commande /topmois (classement mensuel)
  if (req.body && req.body.message && req.body.message.text && req.body.message.text.indexOf("/topmois") === 0) {
    var now2 = new Date();
    var monthStart = new Date(now2.getFullYear(), now2.getMonth(), 1).toISOString();
    var allShops = getShops();
    var allAmazon = getAmazonAccounts();
    var monthResults = [];
    var monthTotalRev = 0;
    var monthTotalOrd = 0;
    for (var ti = 0; ti < allShops.length; ti++) {
      var tOrders = await getShopifyOrders(allShops[ti], monthStart);
      var tRev = 0; var tCnt = 0;
      for (var tj = 0; tj < tOrders.length; tj++) {
        tRev += parseFloat(tOrders[tj].total_price || 0);
        tCnt += 1;
      }
      if (tRev > 0) { monthResults.push({ name: allShops[ti].name, revenue: tRev, orders: tCnt }); }
      monthTotalRev += tRev;
      monthTotalOrd += tCnt;
    }
    for (var tk = 0; tk < allAmazon.length; tk++) {
      var tAmz = await getAmazonOrdersCached(allAmazon[tk], monthStart, "topmois", 10 * 60 * 1000);
      var tAmzRev = getAmazonRevenue(tAmz);
      if (tAmzRev > 0) { monthResults.push({ name: allAmazon[tk].name, revenue: tAmzRev, orders: tAmz.length }); }
      monthTotalRev += tAmzRev;
      monthTotalOrd += tAmz.length;
    }
    monthResults.sort(function(a, b) { return b.revenue - a.revenue; });
    var tMedals = ["\uD83E\uDD47", "\uD83E\uDD48", "\uD83E\uDD49"];
    var tLines = [];
    for (var tm = 0; tm < monthResults.length; tm++) {
      var tMedal = tm < 3 ? tMedals[tm] : "   ";
      var tPct = monthTotalRev > 0 ? ((monthResults[tm].revenue / monthTotalRev) * 100).toFixed(1) : "0";
      var tAvg = monthResults[tm].orders > 0 ? Math.round(monthResults[tm].revenue / monthResults[tm].orders) : 0;
      tLines.push(tMedal + " <b>" + monthResults[tm].name + "</b>\n     \uD83D\uDCB0 " + formatMoney(monthResults[tm].revenue) + " \u20ac (" + tPct + "%)\n     \uD83D\uDED2 " + monthResults[tm].orders + " cmd \u00b7 \u00d8 " + formatMoney(tAvg) + " \u20ac");
    }
    var moisName = MOIS_NAMES[now2.getMonth()];
    var monthAvg = monthTotalOrd > 0 ? Math.round(monthTotalRev / monthTotalOrd) : 0;
    var topMoisMsg = "\uD83C\uDFC6 <b>Classement " + moisName + "</b>\n\n" +
      tLines.join("\n\n") +
      "\n\n\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\n" +
      "\uD83D\uDCB0 <b>Total : " + formatMoney(monthTotalRev) + " \u20ac (" + monthTotalOrd + " commande" + (monthTotalOrd > 1 ? "s" : "") + ")</b>\n" +
      "\uD83D\uDED2 <b>Panier moyen : " + formatMoney(monthAvg) + " \u20ac</b>";
    await sendTelegram(topMoisMsg, getMainButtons());
    return;
  }

  // Commande /topproduits
  if (req.body && req.body.message && req.body.message.text && req.body.message.text.indexOf("/topproduits") === 0) {
    var tpButtons = [
      [
        { text: "\uD83D\uDCC5 Aujourd'hui", callback_data: "tp:d" },
        { text: "\uD83D\uDCC5 7 jours", callback_data: "tp:7" }
      ],
      [
        { text: "\uD83D\uDCC6 Ce mois", callback_data: "tp:m" },
        { text: "\uD83D\uDCCA Cette annee", callback_data: "tp:a" }
      ],
      [
        { text: "\uD83C\uDF0D Tout", callback_data: "tp:all" }
      ]
    ];
    await sendTelegram("\uD83C\uDFC6 <b>Top produits</b>\n\nChoisissez la periode :", tpButtons);
    return;
  }

  // Commande /help
  if (req.body && req.body.message && req.body.message.text && req.body.message.text.indexOf("/help") === 0) {
    var helpMsg = "\uD83D\uDCCB <b>Commandes disponibles</b>\n\n" +
      "\uD83D\uDCCA /stats - Recap du jour + boutons\n" +
      "\uD83C\uDFC6 /top - Classement boutiques (jour)\n" +
      "\uD83C\uDFC6 /topmois - Classement boutiques (mois)\n" +
      "\uD83C\uDFC6 /topproduits - Top produits du mois\n" +
      "\uD83D\uDCC8 /compare - Aujourd'hui vs hier\n" +
      "\uD83D\uDCC6 /mois - Ce mois vs mois dernier\n" +
      "\uD83D\uDCC5 /semaine - CA par jour (7 jours)\n" +
      "\u2753 /help - Cette aide\n\n" +
      "\u23F0 <b>Automatique :</b>\n" +
      "\u2600\uFE0F 8h - Rapport du matin\n" +
      "\uD83C\uDF19 20h - Rapport du soir\n" +
      "\uD83D\uDCC5 Lundi 8h - Rapport hebdo\n" +
      "\uD83C\uDFAF Alerte objectif atteint\n" +
      "\uD83D\uDD25 Alerte grosse commande (+1 000 \u20ac)\n" +
      "\uD83C\uDF89 Milestones (commandes & CA)\n" +
      "\uD83D\uDD25 Streak objectif";
    await sendTelegram(helpMsg, null);
    return;
  }

  // Commande /stats
  if (req.body && req.body.message && req.body.message.text && req.body.message.text.indexOf("/stats") === 0) {
    var stats = resetDailyStatsIfNeeded();
    var recap = await buildRecapMessage();
    var statsMsg = "\uD83D\uDCCA <b>Dashboard</b>" + recap;
    await sendTelegram(statsMsg, getMainButtons());
    return;
  }

  var callback = req.body && req.body.callback_query;
  if (!callback) return;
  var callbackId = callback.id;
  var chatId = callback.message && callback.message.chat.id;
  var messageId = callback.message && callback.message.message_id;
  var data = callback.data;
  await answerCallback(callbackId);
  if (!data || !chatId || !messageId) return;

  if (data === "main_menu") {
    var mainRecap = await buildRecapMessage();
    await editMessage(chatId, messageId, "\uD83D\uDCCA <b>Dashboard</b>" + mainRecap, getMainButtons());
    return;
  }
  if (data === "menu_ventes") {
    await editMessage(chatId, messageId, "\uD83C\uDFEA <b>Choisissez une boutique :</b>", getShopButtons());
    return;
  }
  if (data === "amz_menu") {
    await editMessage(chatId, messageId, "\uD83D\uDCE6 <b>Amazon - Choisissez un pays :</b>", getAmazonCountryButtons());
    return;
  }
  if (data.indexOf("amz:") === 0) {
    var mpId = data.substring(4);
    var mpInfo = MARKETPLACE_MAP[mpId];
    var label = mpInfo ? mpInfo.flag + " Amazon " + mpInfo.name : "Amazon";
    await editMessage(chatId, messageId, "\uD83D\uDCE6 <b>" + label + "</b>\n\n\uD83D\uDCC5 Choisissez une periode :", getAmzPeriodButtons(mpId));
    return;
  }
  if (data.indexOf("ap:") === 0) {
    var parts = data.split(":");
    var aMpId = parts[1];
    var aPeriod = parts[2];
    var aMpInfo = MARKETPLACE_MAP[aMpId];
    var aLabel = aMpInfo ? aMpInfo.flag + " Amazon " + aMpInfo.name : "Amazon";
    var aPeriodLabel = getPeriodLabel(aPeriod);
    await editMessage(chatId, messageId, "\u23F3 <b>Chargement " + aLabel + " - " + aPeriodLabel + "...</b>", null);
    var aStats = await getStatsForShop(null, aPeriod, aMpId);
    var aAvg = aStats.orders > 0 ? Math.round(aStats.revenue / aStats.orders) : 0;
    var aResultMsg = "\uD83D\uDCE6 <b>" + aLabel + " - " + aPeriodLabel + "</b>\n\n\uD83D\uDCB0 CA : " + formatMoney(aStats.revenue) + " \u20ac\n\uD83D\uDCE6 Commandes : " + aStats.orders + "\n\uD83D\uDED2 Panier moyen : " + formatMoney(aAvg) + " \u20ac";
    await editMessage(chatId, messageId, aResultMsg, getAmzPeriodButtons(aMpId));
    return;
  }

  // CA par jour (semaine)

  if (data === "tp_menu") {
    var tpMenuButtons = [
      [
        { text: "\uD83D\uDCC5 Aujourd'hui", callback_data: "tp:d" },
        { text: "\uD83D\uDCC5 7 jours", callback_data: "tp:7" }
      ],
      [
        { text: "\uD83D\uDCC6 Ce mois", callback_data: "tp:m" },
        { text: "\uD83D\uDCCA Cette annee", callback_data: "tp:a" }
      ],
      [
        { text: "\uD83C\uDF0D Tout", callback_data: "tp:all" },
        { text: "\u2B05\uFE0F Retour", callback_data: "main_menu" }
      ]
    ];
    await editMessage(chatId, messageId, "\uD83C\uDFC6 <b>Top produits</b>\n\nChoisissez la periode :", tpMenuButtons);
    return;
  }
  
  // Top produits par periode
  if (data.indexOf("tp:") === 0) {
    var tpPeriod = data.substring(3);
    var now5 = new Date();
    var paris5 = new Date(now5.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
    var tpStart;
    var tpLabel;
    if (tpPeriod === "d") { tpStart = new Date(paris5.getFullYear(), paris5.getMonth(), paris5.getDate()); tpLabel = "aujourd'hui"; }
    else if (tpPeriod === "7") { tpStart = new Date(paris5.getFullYear(), paris5.getMonth(), paris5.getDate() - 6); tpLabel = "7 derniers jours"; }
    else if (tpPeriod === "m") { tpStart = new Date(paris5.getFullYear(), paris5.getMonth(), 1); tpLabel = MOIS_NAMES[paris5.getMonth()]; }
    else if (tpPeriod === "a") { tpStart = new Date(paris5.getFullYear(), 0, 1); tpLabel = "cette annee"; }
    else { tpStart = new Date(2020, 0, 1); tpLabel = "tout"; }
    await editMessage(chatId, messageId, "\u23F3 <b>Chargement...</b>", null);
    var skuNames = await getSkuNames();
    var tpShops = getShops();
    var tpMap = {};
    for (var tpi = 0; tpi < tpShops.length; tpi++) {
      var tpOrders = await getShopifyOrders(tpShops[tpi], tpStart.toISOString());
      for (var tpj = 0; tpj < tpOrders.length; tpj++) {
        var tpItems = tpOrders[tpj].line_items || [];
        for (var tpk = 0; tpk < tpItems.length; tpk++) {
          var tpSku = tpItems[tpk].sku || "no-sku";
          var tpSheetName = skuNames[tpSku];
          var tpName = tpSku === "no-sku" ? "Sur-mesure" : (tpSheetName || tpItems[tpk].title || "Inconnu");
          var tpVariant = tpSheetName ? "" : (tpItems[tpk].variant_title || "");
          var tpQty = tpItems[tpk].quantity || 1;
          var tpRev = parseFloat(tpItems[tpk].price || 0) * tpQty;
          if (!tpMap[tpSku]) { tpMap[tpSku] = { name: tpName, variant: tpVariant, qty: 0, revenue: 0 }; }
          tpMap[tpSku].qty += tpQty;
          tpMap[tpSku].revenue += tpRev;
        }
      }
    }
    var tpList = [];
    var tpKeys = Object.keys(tpMap);
    for (var tpl = 0; tpl < tpKeys.length; tpl++) {
      tpList.push({ sku: tpKeys[tpl], name: tpMap[tpKeys[tpl]].name, variant: tpMap[tpKeys[tpl]].variant, qty: tpMap[tpKeys[tpl]].qty, revenue: tpMap[tpKeys[tpl]].revenue });
    }
    tpList.sort(function(a, b) { return b.revenue - a.revenue; });
    var tpN = Math.min(tpList.length, 10);
    var tpMedals = ["\uD83E\uDD47", "\uD83E\uDD48", "\uD83E\uDD49"];
    var tpLines = [];
    for (var tpm = 0; tpm < tpN; tpm++) {
      var tpMedal = tpm < 3 ? tpMedals[tpm] : (tpm + 1) + ".";
      var tpDisplayName = tpList[tpm].name.substring(0, 50);
      if (tpList[tpm].variant) { tpDisplayName += " (" + tpList[tpm].variant.substring(0, 20) + ")"; }
      tpLines.push(tpMedal + " <b>" + tpDisplayName + "</b>\n     \uD83D\uDCB0 " + formatMoney(tpList[tpm].revenue) + " \u20ac \u00b7 " + tpList[tpm].qty + " vendus");
    }
    var tpMsg = "\uD83C\uDFC6 <b>Top 10 produits (" + tpLabel + ")</b>\n<i>(Shopify - par SKU)</i>\n\n";
    if (tpLines.length === 0) { tpMsg += "Aucune vente sur cette periode."; }
    else { tpMsg += tpLines.join("\n\n"); }
    var tpReturnButtons = [
      [
        { text: "\uD83D\uDCC5 Aujourd'hui", callback_data: "tp:d" },
        { text: "\uD83D\uDCC5 7 jours", callback_data: "tp:7" }
      ],
      [
        { text: "\uD83D\uDCC6 Ce mois", callback_data: "tp:m" },
        { text: "\uD83D\uDCCA Cette annee", callback_data: "tp:a" }
      ],
      [
        { text: "\uD83C\uDF0D Tout", callback_data: "tp:all" },
        { text: "\u2B05\uFE0F Retour", callback_data: "main_menu" }
      ]
    ];
    await editMessage(chatId, messageId, tpMsg, tpReturnButtons);
    return;
  }
  
 // CA par jour de la semaine
  if (data.indexOf("sem:") === 0) {
    var semPeriod = data.substring(4);
    var now4 = new Date();
    var semStart;
    var semLabel;
    if (semPeriod === "7") { semStart = new Date(now4.getFullYear(), now4.getMonth(), now4.getDate() - 6); semLabel = "7 derniers jours"; }
    else if (semPeriod === "30") { semStart = new Date(now4.getFullYear(), now4.getMonth(), now4.getDate() - 29); semLabel = "30 derniers jours"; }
    else if (semPeriod === "365") { semStart = new Date(now4.getFullYear(), 0, 1); semLabel = "cette annee"; }
    else { semStart = new Date(2020, 0, 1); semLabel = "tout"; }
    await editMessage(chatId, messageId, "\u23F3 <b>Chargement...</b>", null);
    var sShops = getShops();
    var sDayTotals = [0, 0, 0, 0, 0, 0, 0];
    var sDayOrders = [0, 0, 0, 0, 0, 0, 0];
    var sDayCounts = [0, 0, 0, 0, 0, 0, 0];
    for (var si = 0; si < sShops.length; si++) {
      var sOrders = await getShopifyOrders(sShops[si], semStart.toISOString());
      for (var sj = 0; sj < sOrders.length; sj++) {
        var sCreated = new Date(sOrders[sj].created_at);
        var sDay = sCreated.getDay();
        sDayTotals[sDay] += parseFloat(sOrders[sj].total_price || 0);
        sDayOrders[sDay] += 1;
      }
    }
    var sAmazon = getAmazonAccounts();
    for (var sk = 0; sk < sAmazon.length; sk++) {
      var sAmz = await getAmazonOrdersCached(sAmazon[sk], semStart.toISOString(), "sem_amz_" + semPeriod, 10 * 60 * 1000);
      for (var sl = 0; sl < sAmz.length; sl++) {
        var sAmzDate = new Date(sAmz[sl].PurchaseDate || sAmz[sl].CreatedBefore);
        if (sAmzDate) {
          var sAmzDay = sAmzDate.getDay();
          sDayTotals[sAmzDay] += (sAmz[sl].OrderTotal && sAmz[sl].OrderTotal.Amount) ? parseFloat(sAmz[sl].OrderTotal.Amount) : 0;
          sDayOrders[sAmzDay] += 1;
        }
      }
    }
    var sMaxRev = 0;
    var sBestDay = 0;
    var sTotalRev = 0;
    var sTotalOrd = 0;
    for (var sm = 0; sm < 7; sm++) {
      if (sDayTotals[sm] > sMaxRev) { sMaxRev = sDayTotals[sm]; sBestDay = sm; }
      sTotalRev += sDayTotals[sm];
      sTotalOrd += sDayOrders[sm];
    }
    var sOrder = [1, 2, 3, 4, 5, 6, 0];
    var sLines = [];
    for (var sn = 0; sn < sOrder.length; sn++) {
      var idx = sOrder[sn];
      var barLen = sMaxRev > 0 ? Math.round((sDayTotals[idx] / sMaxRev) * 8) : 0;
      var sBar = "";
      for (var sb = 0; sb < barLen; sb++) sBar += "\u2588";
      for (var se = barLen; se < 8; se++) sBar += "\u2591";
      var sPct = sTotalRev > 0 ? ((sDayTotals[idx] / sTotalRev) * 100).toFixed(1) : "0";
      var sAvg = sDayOrders[idx] > 0 ? Math.round(sDayTotals[idx] / sDayOrders[idx]) : 0;
      sLines.push(JOUR_NAMES[idx].substring(0, 3) + " " + sBar + " " + formatMoney(sDayTotals[idx]) + "\u20ac (" + sPct + "%) " + sDayOrders[idx] + "cmd");
    }
    var sMsg = "\uD83D\uDCC5 <b>CA par jour de la semaine</b>\n<i>(" + semLabel + ")</i>\n\n<code>" + sLines.join("\n") + "</code>" +
      "\n\n\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\n" +
      "\uD83C\uDFC6 <b>Meilleur jour : " + JOUR_NAMES[sBestDay] + " (" + formatMoney(sDayTotals[sBestDay]) + " \u20ac)</b>\n" +
      "\uD83D\uDCB0 <b>Total : " + formatMoney(sTotalRev) + " \u20ac (" + sTotalOrd + " cmd)</b>";
    var semReturnButtons = [
      [
        { text: "\uD83D\uDCC5 7 jours", callback_data: "sem:7" },
        { text: "\uD83D\uDCC6 30 jours", callback_data: "sem:30" }
      ],
      [
        { text: "\uD83D\uDCCA Cette annee", callback_data: "sem:365" },
        { text: "\uD83C\uDF0D Tout", callback_data: "sem:all" }
      ],
      [{ text: "\u2B05\uFE0F Retour", callback_data: "main_menu" }]
    ];
    await editMessage(chatId, messageId, sMsg, semReturnButtons);
    return;
  }
  
  if (data.indexOf("s:") === 0) {
    var shopName = data.substring(2);
    await editMessage(chatId, messageId, "\uD83C\uDFEA <b>" + shopName + "</b>\n\n\uD83D\uDCC5 Choisissez une periode :", getPeriodButtons(shopName));
    return;
  }
  if (data.indexOf("p:") === 0) {
    var pParts = data.split(":");
    var pShopName = pParts[1];
    var period = pParts[2];
    var periodLabel = getPeriodLabel(period);
    await editMessage(chatId, messageId, "\u23F3 <b>Chargement " + pShopName + " - " + periodLabel + "...</b>", null);
    var pStats;
    if (pShopName === "ALL") { pStats = await getStatsForAll(period); }
    else { pStats = await getStatsForShop(pShopName, period, null); }
    var pAvg = pStats.orders > 0 ? Math.round(pStats.revenue / pStats.orders) : 0;
    var pResultMsg = "\uD83C\uDFEA <b>" + pShopName + " - " + periodLabel + "</b>\n\n\uD83D\uDCB0 CA : " + formatMoney(pStats.revenue) + " \u20ac\n\uD83D\uDCE6 Commandes : " + pStats.orders + "\n\uD83D\uDED2 Panier moyen : " + formatMoney(pAvg) + " \u20ac";
    await editMessage(chatId, messageId, pResultMsg, getPeriodButtons(pShopName));
    return;
  }
});

// ============================================================
// TOTAL pour SMIIRL
// ============================================================

var cachedNumber = 0;
var lastFetch = 0;
var CACHE_DURATION = 5 * 60 * 1000;

async function getTotalRevenue() {
  var now = Date.now();
  if (now - lastFetch < CACHE_DURATION && cachedNumber > 0) { return cachedNumber; }
  var shops = getShops();
  var amazonAccounts = getAmazonAccounts();
  var startOfYear = new Date(new Date().getFullYear(), 0, 1).toISOString();
  var total = 0;
  for (var i = 0; i < shops.length; i++) {
    var orders = await getShopifyOrders(shops[i], startOfYear);
    for (var j = 0; j < orders.length; j++) { total += parseFloat(orders[j].total_price || 0); }
  }
  for (var k = 0; k < amazonAccounts.length; k++) {
    var amzOrders = await getAmazonOrdersCached(amazonAccounts[k], startOfYear, "total_year", 10 * 60 * 1000);
    total += getAmazonRevenue(amzOrders);
  }
  cachedNumber = Math.round(total);
  lastFetch = now;
  console.log("TOTAL GLOBAL: " + cachedNumber + " EUR");
  return cachedNumber;
}

// ============================================================
// ROUTES
// ============================================================

app.get("/", async function (req, res) {
  try { var number = await getTotalRevenue(); res.json({ number: number }); }
  catch (error) { res.json({ number: cachedNumber || 0 }); }
});

app.get("/debug", async function (req, res) {
  var shops = getShops();
  var amazonAccounts = getAmazonAccounts();
  var startOfYear = new Date(new Date().getFullYear(), 0, 1).toISOString();
  var results = [];
  for (var i = 0; i < shops.length; i++) {
    var orders = await getShopifyOrders(shops[i], startOfYear);
    var rev = 0; for (var j = 0; j < orders.length; j++) { rev += parseFloat(orders[j].total_price || 0); }
    results.push({ source: "Shopify", name: shops[i].name, revenue: rev.toFixed(2) });
  }
  for (var k = 0; k < amazonAccounts.length; k++) {
    var amzOrders = await getAmazonOrdersCached(amazonAccounts[k], startOfYear, "debug_year", 10 * 60 * 1000);
    results.push({ source: "Amazon", name: amazonAccounts[k].name, revenue: getAmazonRevenue(amzOrders).toFixed(2) });
  }
  var total = 0; for (var m = 0; m < results.length; m++) { total += parseFloat(results[m].revenue); }
  var today = resetDailyStatsIfNeeded();
  res.json({ shops: results, total: total.toFixed(2), number: Math.round(total), todayRevenue: today._totalRevenue.toFixed(2), todayOrders: today._totalOrders, lastUpdate: new Date().toISOString() });
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
  var shops = getShops();
  var amazonAccounts = getAmazonAccounts();
  console.log("Serveur SMIIRL demarre sur le port " + PORT);
  console.log(shops.length + " boutique(s) Shopify");
  console.log(amazonAccounts.length + " compte(s) Amazon");
  setTimeout(checkNewOrders, 30000);
});
