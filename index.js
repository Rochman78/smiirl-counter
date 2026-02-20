const express = require("express");
const app = express();

// ============================================================
// SHOPIFY
// ============================================================

function getShops() {
  var shops = [];
  for (var i = 1; i <= 20; i++) {
    var domain = process.env["SHOP_" + i];
    var clientId = process.env["SHOP_" + i + "_CLIENT_ID"];
    var clientSecret = process.env["SHOP_" + i + "_CLIENT_SECRET"];
    if (domain && clientId && clientSecret) {
      shops.push({
        domain: domain,
        clientId: clientId,
        clientSecret: clientSecret
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

async function getShopifyRevenue(shop) {
  var token = await getShopifyAccessToken(shop);
  if (!token) return 0;

  var now = new Date();
  var startOfYear = new Date(now.getFullYear(), 0, 1).toISOString();

  var totalRevenue = 0;
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
        "&created_at_min=" + startOfYear +
        "&fields=total_price" +
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
        totalRevenue += parseFloat(orders[j].total_price || 0);
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

  console.log("Shopify " + shop.domain + ": " + totalRevenue.toFixed(2) + " EUR");
  return totalRevenue;
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
    if (clientId && clientSecret && refreshToken) {
      accounts.push({
        name: "Amazon " + i,
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

async function getAmazonRevenue(account) {
  var token = await getAmazonAccessToken(account);
  if (!token) return 0;

  var now = new Date();
  var startOfYear = new Date(now.getFullYear(), 0, 1).toISOString();

  var totalRevenue = 0;
  var nextToken = null;
  var isFirstRequest = true;

  while (isFirstRequest || nextToken) {
    isFirstRequest = false;

    var url = account.endpoint + "/orders/v0/orders" +
      "?MarketplaceIds=" + account.marketplace +
      "&CreatedAfter=" + encodeURIComponent(startOfYear) +
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
        var order = orders[j];
        if (order.OrderTotal && order.OrderTotal.Amount) {
          totalRevenue += parseFloat(order.OrderTotal.Amount);
        }
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

  console.log(account.name + ": " + totalRevenue.toFixed(2) + " EUR");
  return totalRevenue;
}

// ============================================================
// TOTAL (Shopify + Amazon)
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

  console.log("Recuperation du CA pour " + shops.length + " boutique(s) Shopify et " + amazonAccounts.length + " compte(s) Amazon...");

  var shopifyRevenues = await Promise.all(shops.map(getShopifyRevenue));
  var amazonRevenues = await Promise.all(amazonAccounts.map(getAmazonRevenue));

  var total = 0;
  for (var i = 0; i < shopifyRevenues.length; i++) {
    total += shopifyRevenues[i];
  }
  for (var j = 0; j < amazonRevenues.length; j++) {
    total += amazonRevenues[j];
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
  var results = [];

  for (var i = 0; i < shops.length; i++) {
    var revenue = await getShopifyRevenue(shops[i]);
    results.push({ source: "Shopify", name: shops[i].domain, revenue: revenue.toFixed(2) });
  }

  for (var j = 0; j < amazonAccounts.length; j++) {
    var amzRevenue = await getAmazonRevenue(amazonAccounts[j]);
    results.push({ source: "Amazon", name: amazonAccounts[j].name, revenue: amzRevenue.toFixed(2) });
  }

  var total = 0;
  for (var k = 0; k < results.length; k++) {
    total += parseFloat(results[k].revenue);
  }

  res.json({
    shops: results,
    total: total.toFixed(2),
    number: Math.round(total),
    lastUpdate: new Date().toISOString(),
  });
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
  var shops = getShops();
  var amazonAccounts = getAmazonAccounts();
  console.log("Serveur SMIIRL demarre sur le port " + PORT);
  console.log(shops.length + " boutique(s) Shopify configuree(s)");
  console.log(amazonAccounts.length + " compte(s) Amazon configure(s)");
});
