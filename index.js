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

var MARKETPLACE_MAP = {
  "A13V1IB3VIYZZH": { flag: "\ud83c\uddeb\ud83c\uddf7", name: "FR" },
  "A1PA6795UKMFR9": { flag: "\ud83c\udde9\ud83c\uddea", name: "DE" },
  "A1RKKUPIHCS9HS": { flag: "\ud83c\uddea\ud83c\uddf8", name: "ES" },
  "APJ6JRA9NG5V4": { flag: "\ud83c\uddee\ud83c\uddf9", name: "IT" },
  "A1F83G8C2ARO7P": { flag: "\ud83c\uddec\ud83c\udde7", name: "UK" },
  "A1805IZSGTT6HS": { flag: "\ud83c\uddf3\ud83c\uddf1", name: "NL" },
  "AMEN7PMS3EDWL": { flag: "\ud83c\udde7\ud83c\uddea", name: "BE" },
  "A2NODRKZP88ZB9": { flag: "\ud83c\uddf8\ud83c\uddea", name: "SE" },
  "A1C3SOZRARQ6R3": { flag: "\ud83c\uddf5\ud83c\uddf1", name: "PL" }
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
        "&fields=id,total_price,created_at,name&limit=250";
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
  var start, end;
  if (period === "d") { start = new Date(now.getFullYear(), now.getMonth(), now.getDate()); end = now; }
  else if (period === "h") { start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1); end = new Date(now.getFullYear(), now.getMonth(), now.getDate()); }
  else if (period === "m") { start = new Date(now.getFullYear(), now.getMonth(), 1); end = now; }
  else if (period === "a") { start = new Date(now.getFullYear(), 0, 1); end = now; }
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
    [{ text: "\ud83d\udcb8 Ventes", callback_data: "menu_ventes" }]
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
  buttons.push([{ text: "\ud83d\udce6 Amazon EU", callback_data: "amz_menu" }]);
  buttons.push([{ text: "\ud83c\udf0d ALL", callback_data: "s:ALL" }]);
  buttons.push([{ text: "\u2b05\ufe0f Retour", callback_data: "main_menu" }]);
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
  buttons.push([{ text: "\ud83d\udce6 ALL AMAZON", callback_data: "s:ALL_AMAZON" }]);
  buttons.push([{ text: "\u2b05\ufe0f Retour", callback_data: "menu_ventes" }]);
  return buttons;
}

function getPeriodButtons(shopName) {
  return [
    [
      { text: "\ud83d\udcc5 Aujourd'hui", callback_data: "p:" + shopName + ":d" },
      { text: "\u23ea Hier", callback_data: "p:" + shopName + ":h" }
    ],
    [
      { text: "\ud83d\udcc6 Ce mois", callback_data: "p:" + shopName + ":m" },
      { text: "\ud83d\udcca Cette annee", callback_data: "p:" + shopName + ":a" }
    ],
    [
      { text: "\u2b05\ufe0f Retour", callback_data: "menu_ventes" }
    ]
  ];
}

function getAmzPeriodButtons(marketplaceId) {
  return [
    [
      { text: "\ud83d\udcc5 Aujourd'hui", callback_data: "ap:" + marketplaceId + ":d" },
      { text: "\u23ea Hier", callback_data: "ap:" + marketplaceId + ":h" }
    ],
    [
      { text: "\ud83d\udcc6 Ce mois", callback_data: "ap:" + marketplaceId + ":m" },
      { text: "\ud83d\udcca Cette annee", callback_data: "ap:" + marketplaceId + ":a" }
    ],
    [
      { text: "\u2b05\ufe0f Retour pays", callback_data: "amz_menu" },
      { text: "\u2b05\ufe0f Retour", callback_data: "menu_ventes" }
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
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
}

function resetDailyStatsIfNeeded() {
  var today = getTodayKey();
  if (!dailyShopStats._date || dailyShopStats._date !== today) {
    dailyShopStats = { _date: today, _totalRevenue: 0, _totalOrders: 0 };
    objectifAlertSent = false;
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
  var medals = ["\ud83e\udd47", "\ud83e\udd48", "\ud83e\udd49"];
  var lines = [];
  for (var j = 0; j < shops.length; j++) {
    var medal = j < 3 ? medals[j] : "   ";
    var pct = stats._totalRevenue > 0 ? ((shops[j].revenue / stats._totalRevenue) * 100).toFixed(1) : "0";
    var avg = shops[j].orders > 0 ? Math.round(shops[j].revenue / shops[j].orders) : 0;
    lines.push(medal + " <b>" + shops[j].name + "</b>\n     \ud83d\udcb0 " + formatMoney(shops[j].revenue) + " \u20ac (" + pct + "%)\n     \ud83d\uded2 " + shops[j].orders + " cmd \u00b7 \u00d8 " + formatMoney(avg) + " \u20ac");
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
    progressLine = "\n\n\ud83c\udfaf <b>Objectif : " + formatMoney(objectif) + " \u20ac</b>\n" + bar;
  }
  var globalAvg = stats._totalOrders > 0 ? Math.round(stats._totalRevenue / stats._totalOrders) : 0;
  return "\n\n\ud83d\udcca <b>Recap du jour :</b>\n\n" + top +
    "\n\n\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\n" +
    "\ud83d\udcb0 <b>Total : " + formatMoney(stats._totalRevenue) + " \u20ac (" + stats._totalOrders + " commande" + (stats._totalOrders > 1 ? "s" : "") + ")</b>\n" +
    "\ud83d\uded2 <b>Panier moyen : " + formatMoney(globalAvg) + " \u20ac</b>" +
    progressLine;
}

async function checkNewOrders() {
  var shops = getShops();
  var amazonAccounts = getAmazonAccounts();
  var now = new Date();
  var startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
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
            var emoji = amount >= grosseCommandeSeuil ? "\ud83d\udd25\ud83d\udd25\ud83d\udd25" : "\ud83d\uded2";
            var bigLabel = amount >= grosseCommandeSeuil ? "\n\ud83d\udc8e <b>GROSSE COMMANDE !</b>" : "";
            var recap = await buildRecapMessage();
            var msg = emoji + " <b>Nouvelle commande sur " + shop.name + " !</b>" + bigLabel + "\n\ud83d\udcb0 Montant : " + formatMoney(amount) + " \u20ac" + recap;
            await sendTelegram(msg, getMainButtons());
            await checkObjectifAtteint();
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
            var amzEmoji = amzAmount >= grosseCommandeSeuil ? "\ud83d\udd25\ud83d\udd25\ud83d\udd25" : "\ud83d\udce6";
            var amzBigLabel = amzAmount >= grosseCommandeSeuil ? "\n\ud83d\udc8e <b>GROSSE COMMANDE !</b>" : "";
            var amzRecap = await buildRecapMessage();
            var amzMsg = amzEmoji + " <b>Nouvelle commande sur " + amzLabel + " !</b>" + amzBigLabel + "\n\ud83d\udcb0 Montant : " + formatMoney(amzAmount) + " \u20ac" + amzRecap;
            await sendTelegram(amzMsg, getMainButtons());
            await checkObjectifAtteint();
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
    var bar = buildProgressBar(stats._totalRevenue, objectif);
    var msg = "\ud83c\udfaf\ud83c\udf89 <b>OBJECTIF DU JOUR ATTEINT !</b>\n\n" +
      "\ud83d\udcb0 " + formatMoney(stats._totalRevenue) + " \u20ac / " + formatMoney(objectif) + " \u20ac\n" +
      bar + "\n\n" +
      "Bravo ! \ud83d\ude80";
    await sendTelegram(msg, null);
  }
}

setInterval(checkNewOrders, 60 * 1000);

// Rapport auto du soir a 20h
var eveningReportSent = false;

// Rapport hebdo lundi matin 8h
var weeklyReportSent = false;

setInterval(async function () {
  var hour = getParisHour();
  var minute = getParisMinute();
  var day = getParisDay();

  // Rapport du soir 20h
  if (hour === 20 && minute === 0 && !eveningReportSent) {
    eveningReportSent = true;
    var stats = resetDailyStatsIfNeeded();
    if (stats._totalOrders > 0) {
      var recap = await buildRecapMessage();
      var msg = "\ud83c\udf19 <b>Rapport du soir</b>" + recap;
      await sendTelegram(msg, getMainButtons());
    } else {
      await sendTelegram("\ud83c\udf19 <b>Rapport du soir</b>\n\nAucune vente aujourd'hui.", null);
    }
  }
  if (hour === 20 && minute === 1) { eveningReportSent = false; }
  if (hour === 0 && minute === 0) { eveningReportSent = false; }

  // Rapport hebdo lundi 8h
  if (day === 1 && hour === 8 && minute === 0 && !weeklyReportSent) {
    weeklyReportSent = true;
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

      for (var i = 0; i < shops.length; i++) {
        var orders = await getShopifyOrders(shops[i], weekStart);
        var rev = 0;
        var cnt = 0;
        for (var j = 0; j < orders.length; j++) {
          var created = new Date(orders[j].created_at);
          if (created <= lastSunday) {
            rev += parseFloat(orders[j].total_price || 0);
            cnt += 1;
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
      var medals = ["\ud83e\udd47", "\ud83e\udd48", "\ud83e\udd49"];
      var lines = [];
      for (var m = 0; m < shopResults.length; m++) {
        var medal = m < 3 ? medals[m] : "   ";
        var pct = weekRevenue > 0 ? ((shopResults[m].revenue / weekRevenue) * 100).toFixed(1) : "0";
        var avg = shopResults[m].orders > 0 ? Math.round(shopResults[m].revenue / shopResults[m].orders) : 0;
        lines.push(medal + " <b>" + shopResults[m].name + "</b>\n     \ud83d\udcb0 " + formatMoney(shopResults[m].revenue) + " \u20ac (" + pct + "%)\n     \ud83d\uded2 " + shopResults[m].orders + " cmd \u00b7 \u00d8 " + formatMoney(avg) + " \u20ac");
      }

      var weekAvg = weekOrders > 0 ? Math.round(weekRevenue / weekOrders) : 0;
      var weekMsg = "\ud83d\udcc5 <b>Rapport hebdomadaire</b>\n\n" +
        lines.join("\n\n") +
        "\n\n\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\n" +
        "\ud83d\udcb0 <b>Total semaine : " + formatMoney(weekRevenue) + " \u20ac (" + weekOrders + " commande" + (weekOrders > 1 ? "s" : "") + ")</b>\n" +
        "\ud83d\uded2 <b>Panier moyen : " + formatMoney(weekAvg) + " \u20ac</b>";
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

  // Commande /compare
  if (req.body && req.body.message && req.body.message.text && req.body.message.text.indexOf("/compare") === 0) {
    var cHour = getParisHour();
    var cMin = getParisMinute();
    var todayStats = await getStatsForAll("d");
    var yesterdayStats = await getStatsForAll("h");
    var diff = todayStats.revenue - yesterdayStats.revenue;
    var arrow = diff >= 0 ? "\ud83d\udcc8" : "\ud83d\udcc9";
    var sign = diff >= 0 ? "+" : "";
    var pctChange = yesterdayStats.revenue > 0 ? ((diff / yesterdayStats.revenue) * 100).toFixed(1) : "N/A";
    var todayAvg = todayStats.orders > 0 ? Math.round(todayStats.revenue / todayStats.orders) : 0;
    var yesterdayAvg = yesterdayStats.orders > 0 ? Math.round(yesterdayStats.revenue / yesterdayStats.orders) : 0;
    var compareMsg = "\ud83d\udcca <b>Comparaison</b>\n\n" +
      "\ud83d\udcc5 <b>Aujourd'hui</b> (a " + cHour + "h" + String(cMin).padStart(2, "0") + ")\n" +
      "     \ud83d\udcb0 " + formatMoney(todayStats.revenue) + " \u20ac\n" +
      "     \ud83d\uded2 " + todayStats.orders + " cmd \u00b7 \u00d8 " + formatMoney(todayAvg) + " \u20ac\n\n" +
      "\u23ea <b>Hier (journee complete)</b>\n" +
      "     \ud83d\udcb0 " + formatMoney(yesterdayStats.revenue) + " \u20ac\n" +
      "     \ud83d\uded2 " + yesterdayStats.orders + " cmd \u00b7 \u00d8 " + formatMoney(yesterdayAvg) + " \u20ac\n\n" +
      "\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\n" +
      arrow + " <b>" + sign + formatMoney(Math.abs(diff)) + " \u20ac (" + sign + pctChange + "%)</b>";
    await sendTelegram(compareMsg, getMainButtons());
    return;
  }

  // Commande /top
  if (req.body && req.body.message && req.body.message.text && req.body.message.text.indexOf("/top") === 0) {
    var topStats = resetDailyStatsIfNeeded();
    if (topStats._totalOrders === 0) {
      await sendTelegram("\ud83c\udfc6 <b>Top boutiques</b>\n\nAucune vente aujourd'hui.", null);
      return;
    }
    var globalAvgTop = topStats._totalOrders > 0 ? Math.round(topStats._totalRevenue / topStats._totalOrders) : 0;
    var topMsg = "\ud83c\udfc6 <b>Top boutiques du jour</b>\n\n" + buildTopBoutiques() +
      "\n\n\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\n" +
      "\ud83d\udcb0 <b>Total : " + formatMoney(topStats._totalRevenue) + " \u20ac (" + topStats._totalOrders + " commande" + (topStats._totalOrders > 1 ? "s" : "") + ")</b>\n" +
      "\ud83d\uded2 <b>Panier moyen : " + formatMoney(globalAvgTop) + " \u20ac</b>";
    await sendTelegram(topMsg, getMainButtons());
    return;
  }

  // Commande /help
  if (req.body && req.body.message && req.body.message.text && req.body.message.text.indexOf("/help") === 0) {
    var helpMsg = "\ud83d\udccb <b>Commandes disponibles</b>\n\n" +
      "\ud83d\udcca /stats - Recap du jour + boutons\n" +
      "\ud83c\udfc6 /top - Classement des boutiques\n" +
      "\ud83d\udcc8 /compare - Aujourd'hui vs hier\n" +
      "\u2753 /help - Cette aide\n\n" +
      "\u23f0 <b>Automatique :</b>\n" +
      "\ud83c\udf19 20h - Rapport du soir\n" +
      "\ud83d\udcc5 Lundi 8h - Rapport hebdo\n" +
      "\ud83c\udfaf Alerte objectif atteint\n" +
      "\ud83d\udd25 Alerte grosse commande (+1 000 \u20ac)";
    await sendTelegram(helpMsg, null);
    return;
  }

  // Commande /stats
  if (req.body && req.body.message && req.body.message.text && req.body.message.text.indexOf("/stats") === 0) {
    var stats = resetDailyStatsIfNeeded();
    var recap = await buildRecapMessage();
    var statsMsg = "\ud83d\udcca <b>Dashboard</b>" + recap;
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

  // Menu principal
  if (data === "main_menu") {
    var mainRecap = await buildRecapMessage();
    await editMessage(chatId, messageId, "\ud83d\udcca <b>Dashboard</b>" + mainRecap, getMainButtons());
    return;
  }

  // Menu ventes (liste des boutiques)
  if (data === "menu_ventes") {
    await editMessage(chatId, messageId, "\ud83c\udfea <b>Choisissez une boutique :</b>", getShopButtons());
    return;
  }

  // Menu Amazon pays
  if (data === "amz_menu") {
    await editMessage(chatId, messageId, "\ud83d\udce6 <b>Amazon - Choisissez un pays :</b>", getAmazonCountryButtons());
    return;
  }

  // Selection pays Amazon
  if (data.indexOf("amz:") === 0) {
    var mpId = data.substring(4);
    var mpInfo = MARKETPLACE_MAP[mpId];
    var label = mpInfo ? mpInfo.flag + " Amazon " + mpInfo.name : "Amazon";
    await editMessage(chatId, messageId, "\ud83d\udce6 <b>" + label + "</b>\n\n\ud83d\udcc5 Choisissez une periode :", getAmzPeriodButtons(mpId));
    return;
  }

  // Periode Amazon par pays
  if (data.indexOf("ap:") === 0) {
    var parts = data.split(":");
    var aMpId = parts[1];
    var aPeriod = parts[2];
    var aMpInfo = MARKETPLACE_MAP[aMpId];
    var aLabel = aMpInfo ? aMpInfo.flag + " Amazon " + aMpInfo.name : "Amazon";
    var aPeriodLabel = getPeriodLabel(aPeriod);
    await editMessage(chatId, messageId, "\u23f3 <b>Chargement " + aLabel + " - " + aPeriodLabel + "...</b>", null);
    var aStats = await getStatsForShop(null, aPeriod, aMpId);
    var aAvg = aStats.orders > 0 ? Math.round(aStats.revenue / aStats.orders) : 0;
    var aResultMsg = "\ud83d\udce6 <b>" + aLabel + " - " + aPeriodLabel + "</b>\n\n\ud83d\udcb0 CA : " + formatMoney(aStats.revenue) + " \u20ac\n\ud83d\udce6 Commandes : " + aStats.orders + "\n\ud83d\uded2 Panier moyen : " + formatMoney(aAvg) + " \u20ac";
    await editMessage(chatId, messageId, aResultMsg, getAmzPeriodButtons(aMpId));
    return;
  }

  // Selection boutique Shopify
  if (data.indexOf("s:") === 0) {
    var shopName = data.substring(2);
    await editMessage(chatId, messageId, "\ud83c\udfea <b>" + shopName + "</b>\n\n\ud83d\udcc5 Choisissez une periode :", getPeriodButtons(shopName));
    return;
  }

  // Periode Shopify / ALL / ALL_AMAZON
  if (data.indexOf("p:") === 0) {
    var pParts = data.split(":");
    var pShopName = pParts[1];
    var period = pParts[2];
    var periodLabel = getPeriodLabel(period);
    await editMessage(chatId, messageId, "\u23f3 <b>Chargement " + pShopName + " - " + periodLabel + "...</b>", null);
    var pStats;
    if (pShopName === "ALL") { pStats = await getStatsForAll(period); }
    else { pStats = await getStatsForShop(pShopName, period, null); }
    var pAvg = pStats.orders > 0 ? Math.round(pStats.revenue / pStats.orders) : 0;
    var pResultMsg = "\ud83c\udfea <b>" + pShopName + " - " + periodLabel + "</b>\n\n\ud83d\udcb0 CA : " + formatMoney(pStats.revenue) + " \u20ac\n\ud83d\udce6 Commandes : " + pStats.orders + "\n\ud83d\uded2 Panier moyen : " + formatMoney(pAvg) + " \u20ac";
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
