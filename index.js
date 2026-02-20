const express = require("express");
const app = express();

// ============================================================
// TELEGRAM
// ============================================================

var TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
var TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTelegram(message) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch("https://api.telegram.org/bot" + TELEGRAM_TOKEN + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "HTML"
      })
    });
  } catch (error) {
    console.error("Erreur Telegram: " + error.message);
  }
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
      shops.push({
        domain: domain,
        clientId: clientId,
        clientSecret: clientSecret,
        name: name
      });
    }
  }
  return shops;
}

var shopifyTokenCache = {};

async function getShopifyAccessToken(shop) {
  var now = Date.now();
  var cached = shopifyTokenCache[shop.domain];
  if (cached && now - cached.obtainedAt < 23 * 60 * 60 * 1000) {
    return cached.token;
  }

  var url = "https://" + shop.domain + "/admin/oauth/access_token";
  var response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: shop.clientId,
      client_secret: shop.clientSecret,
    }),
  });

  if (!response.ok) {
    var text = await response.text();
    console.error("Erreur token Shopify pour " + shop.domain + ": " + response.status + " - " + text);
    return null;
  }

  var data = await response.json();
  var token = data.access_token;
  shopifyTokenCache[shop.domain] = { token: token, obtainedAt: now };
  console.log("Token Shopify obtenu pour " + shop.domain);
  return token;
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
    if (nextPageUrl) {
      url = nextPageUrl;
    } else {
      url = "https://" + shop.domain + "/admin/api/2024-01/orders.json" +
        "?status=any" +
        "&financial_status=paid,partially_refunded" +
        "&created_at_min=" + since +
        "&fields=id,total_price,created_at,name" +
        "&limit=250";
    }

    try {
      var response = await fetch(url, {
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        console.error("Erreur Shopify " + response.status + " pour " + shop.domain);
        break;
      }

      var data = await response.json();
      var orders = data.orders || [];

      for (var j = 0; j < orders.length; j++) {
        allOrders.push(orders[j]);
      }

      var linkHeader = response.headers.get("link");
      nextPageUrl = null;
      if (linkHeader) {
        var nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
        if (nextMatch) nextPageUrl = nextMatch[1];
      }
    } catch (error) {
      console.error("Erreur Shopify pour " + shop.domain + ": " + error.message);
      break;
    }
  }

  return allOrders;
}

function getShopifyRevenue(orders) {
  var total = 0;
  for (var i = 0; i < orders.length; i++) {
    total += parseFloat(orders[i].total_price || 0);
  }
  return total;
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
      accounts.push({
        name: name,
        clientId: clientId,
        clientSecret: clientSecret,
        refreshToken: refreshToken,
        marketplace: marketplace,
        endpoint: endpoint
      });
    }
  }
  return accounts;
}

var amazonTokenCache = {};

async function getAmazonAccessToken(account) {
  var now = Date.now();
  var cached = amazonTokenCache[account.name];
  if (cached && now - cached.obtainedAt < 50 * 60 * 1000) {
    return cached.token;
  }

  var response = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=refresh_token" +
      "&client_id=" + encodeURIComponent(account.clientId) +
      "&client_secret=" + encodeURIComponent(account.clientSecret) +
      "&refresh_token=" + encodeURIComponent(account.refreshToken),
  });

  if (!response.ok) {
    var text = await response.text();
    console.error("Erreur token Amazon " + account.name + ": " + response.status + " - " + text);
    return null;
  }

  var data = await response.json();
  var token = data.access_token;
  amazonTokenCache[account.name] = { token: token, obtainedAt: now };
  console.log("Token Amazon obtenu pour " + account.name);
  return token;
}

async function getAmazonOrders(account, since) {
  var token = await getAmazonAccessToken(account);
  if (!token) return [];

  var allOrders = [];
  var nextToken = null;
  var isFirstRequest = true;

  while (isFirstRequest || nextToken) {
    isFirstRequest = false;

    var url = account.endpoint + "/orders/v0/orders" +
      "?MarketplaceIds=" + account.marketplace +
      "&CreatedAfter=" + encodeURIComponent(since) +
      "&OrderStatuses=Shipped,Unshipped" +
      "&MaxResultsPerPage=100";

    if (nextToken) {
      url += "&NextToken=" + encodeURIComponent(nextToken);
    }

    try {
      var response = await fetch(url, {
        headers: {
          "x-amz-access-token": token,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        var text = await response.text();
        console.error("Erreur Amazon " + response.status + " pour " + account.name + ": " + text);
        break;
      }

      var data = await response.json();
      var orders = data.payload && data.payload.Orders ? data.payload.Orders : [];

      for (var j = 0; j < orders.length; j++) {
        allOrders.push(orders[j]);
      }

      nextToken = null;
      if (data.payload && data.payload.NextToken) {
        nextToken = data.payload.NextToken;
      }
    } catch (error) {
      console.error("Erreur Amazon pour " + account.name + ": " + error.message);
      break;
    }
  }

  return allOrders;
}

function getAmazonRevenue(orders) {
  var total = 0;
  for (var i = 0; i < orders.length; i++) {
    if (orders[i].OrderTotal && orders[i].OrderTotal.Amount) {
      total += parseFloat(orders[i].OrderTotal.Amount);
    }
  }
  return total;
}

// ============================================================
// NOTIFICATIONS - Detection des nouvelles commandes
// ============================================================

var knownOrderIds = {};
var dailyStats = {};
var firstRun = true;

function getTodayKey() {
  var now = new Date();
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
}

function resetDailyStatsIfNeeded() {
  var today = getTodayKey();
  if (!dailyStats[today]) {
    dailyStats = {};
    dailyStats[today] = { revenue: 0, orders: 0 };
  }
  return dailyStats[today];
}

function formatMoney(amount) {
  return amount.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

async function checkNewOrders() {
  var shops = getShops();
  var amazonAccounts = getAmazonAccounts();
  var now = new Date();
  var startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  var stats = resetDailyStatsIfNeeded();

  // Shopify
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
          if (!firstRun) {
            stats.revenue += amount;
            stats.orders += 1;
            var msg = "🛒 <b>Nouvelle commande sur " + shop.name + " !</b>\n" +
              "💰 Montant : " + formatMoney(amount) + " €\n" +
              "📊 Recap du jour : " + formatMoney(stats.revenue) + " € (" + stats.orders + " commande" + (stats.orders > 1 ? "s" : "") + ")";
            await sendTelegram(msg);
          } else {
            stats.revenue += amount;
            stats.orders += 1;
          }
        }
      }
    } catch (error) {
      console.error("Erreur check commandes " + shop.name + ": " + error.message);
    }
  }

  // Amazon
  for (var k = 0; k < amazonAccounts.length; k++) {
    var account = amazonAccounts[k];
    try {
      var amzOrders = await getAmazonOrders(account, startOfDay);
      for (var l = 0; l < amzOrders.length; l++) {
        var amzOrder = amzOrders[l];
        var amzOrderId = "amazon_" + account.name + "_" + amzOrder.AmazonOrderId;
        if (!knownOrderIds[amzOrderId]) {
          knownOrderIds[amzOrderId] = true;
          var amzAmount = 0;
          if (amzOrder.OrderTotal && amzOrder.OrderTotal.Amount) {
            amzAmount = parseFloat(amzOrder.OrderTotal.Amount);
          }
          if (!firstRun) {
            stats.revenue += amzAmount;
            stats.orders += 1;
            var amzMsg = "📦 <b>Nouvelle commande sur " + account.name + " !</b>\n" +
              "💰 Montant : " + formatMoney(amzAmount) + " €\n" +
              "📊 Recap du jour : " + formatMoney(stats.revenue) + " € (" + stats.orders + " commande" + (stats.orders > 1 ? "s" : "") + ")";
            await sendTelegram(amzMsg);
          } else {
            stats.revenue += amzAmount;
            stats.orders += 1;
          }
        }
      }
    } catch (error) {
      console.error("Erreur check commandes " + account.name + ": " + error.message);
    }
  }

  if (firstRun) {
    firstRun = false;
    console.log("Premier scan: " + stats.orders + " commandes du jour detectees (" + formatMoney(stats.revenue) + " EUR)");
  }
}

// Verifier les nouvelles commandes toutes les 60 secondes
setInterval(checkNewOrders, 60 * 1000);

// ============================================================
// TOTAL (Shopify + Amazon) pour le compteur SMIIRL
// ============================================================

var cachedNumber = 0;
var lastFetch = 0;
var CACHE_DURATION = 60 * 1000;

async function getTotalRevenue() {
  var now = Date.now();
  if (now - lastFetch < CACHE_DURATION && cachedNumber > 0) {
    return cachedNumber;
  }

  var shops = getShops();
  var amazonAccounts = getAmazonAccounts();
  var startOfYear = new Date(new Date().getFullYear(), 0, 1).toISOString();

  var total = 0;

  for (var i = 0; i < shops.length; i++) {
    var orders = await getShopifyOrders(shops[i], startOfYear);
    total += getShopifyRevenue(orders);
    console.log("Shopify " + shops[i].name + ": " + getShopifyRevenue(orders).toFixed(2) + " EUR");
  }

  for (var j = 0; j < amazonAccounts.length; j++) {
    var amzOrders = await getAmazonOrders(amazonAccounts[j], startOfYear);
    var amzRev = getAmazonRevenue(amzOrders);
    total += amzRev;
    console.log("Amazon " + amazonAccounts[j].name + ": " + amzRev.toFixed(2) + " EUR");
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
  try {
    var number = await getTotalRevenue();
    res.json({ number: number });
  } catch (error) {
    console.error("Erreur:", error);
    res.json({ number: cachedNumber || 0 });
  }
});

app.get("/debug", async function (req, res) {
  var shops = getShops();
  var amazonAccounts = getAmazonAccounts();
  var startOfYear = new Date(new Date().getFullYear(), 0, 1).toISOString();
  var results = [];

  for (var i = 0; i < shops.length; i++) {
    var orders = await getShopifyOrders(shops[i], startOfYear);
    var revenue = getShopifyRevenue(orders);
    results.push({ source: "Shopify", name: shops[i].name, revenue: revenue.toFixed(2) });
  }

  for (var j = 0; j < amazonAccounts.length; j++) {
    var amzOrders = await getAmazonOrders(amazonAccounts[j], startOfYear);
    var amzRevenue = getAmazonRevenue(amzOrders);
    results.push({ source: "Amazon", name: amazonAccounts[j].name, revenue: amzRevenue.toFixed(2) });
  }

  var total = 0;
  for (var k = 0; k < results.length; k++) {
    total += parseFloat(results[k].revenue);
  }

  var today = resetDailyStatsIfNeeded();

  res.json({
    shops: results,
    total: total.toFixed(2),
    number: Math.round(total),
    todayRevenue: today.revenue.toFixed(2),
    todayOrders: today.orders,
    lastUpdate: new Date().toISOString(),
  });
});
app.get("/test", async function (req, res) {
  var stats = resetDailyStatsIfNeeded();
  var msg = "🛒 <b>Nouvelle commande sur LFC !</b>\n" +
    "💰 Montant : 1 250 €\n" +
    "📊 Recap du jour : " + formatMoney(stats.revenue + 1250) + " € (" + (stats.orders + 1) + " commande" + (stats.orders + 1 > 1 ? "s" : "") + ")";
  await sendTelegram(msg);
  res.json({ ok: true, message: "Notification test envoyee !" });
});
var PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
  var shops = getShops();
  var amazonAccounts = getAmazonAccounts();
  console.log("Serveur SMIIRL demarre sur le port " + PORT);
  console.log(shops.length + " boutique(s) Shopify configuree(s)");
  console.log(amazonAccounts.length + " compte(s) Amazon configure(s)");
  // Premier scan au demarrage
  checkNewOrders();
});
