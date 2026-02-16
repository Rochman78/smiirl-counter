const express = require("express");
const app = express();

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

var tokenCache = {};

async function getAccessToken(shop) {
  var now = Date.now();
  var cached = tokenCache[shop.domain];
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
    console.error("Erreur token pour " + shop.domain + ": " + response.status + " - " + text);
    return null;
  }

  var data = await response.json();
  var token = data.access_token;
  tokenCache[shop.domain] = { token: token, obtainedAt: now };
  console.log("Token obtenu pour " + shop.domain);
  return token;
}

async function getShopRevenue(shop) {
  var token = await getAccessToken(shop);
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
        console.error("Erreur " + response.status + " pour " + shop.domain);
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
      console.error("Erreur pour " + shop.domain + ": " + error.message);
      break;
    }
  }

  console.log(shop.domain + ": " + totalRevenue.toFixed(2) + " EUR");
  return totalRevenue;
}

var cachedNumber = 0;
var lastFetch = 0;
var CACHE_DURATION = 60 * 1000;

async function getTotalRevenue() {
  var now = Date.now();
  if (now - lastFetch < CACHE_DURATION && cachedNumber > 0) {
    return cachedNumber;
  }

  var shops = getShops();
  if (shops.length === 0) {
    console.error("Aucune boutique configuree !");
    return 0;
  }

  console.log("Recuperation du CA pour " + shops.length + " boutique(s)...");
  var revenues = await Promise.all(shops.map(getShopRevenue));
  var total = 0;
  for (var i = 0; i < revenues.length; i++) {
    total += revenues[i];
  }

  cachedNumber = Math.round(total);
  lastFetch = now;
  console.log("TOTAL: " + cachedNumber + " EUR");
  return cachedNumber;
}

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
  var results = [];
  for (var i = 0; i < shops.length; i++) {
    var revenue = await getShopRevenue(shops[i]);
    results.push({ domain: shops[i].domain, revenue: revenue.toFixed(2) });
  }
  var total = 0;
  for (var j = 0; j < results.length; j++) {
    total += parseFloat(results[j].revenue);
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
  console.log("Serveur SMIIRL demarre sur le port " + PORT);
  console.log(shops.length + " boutique(s) configuree(s)");
});
