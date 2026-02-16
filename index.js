const express = require("express");
const app = express();

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

function getShopDomains() {
  const shops = [];
  for (let i = 1; i <= 20; i++) {
    const domain = process.env[`SHOP_${i}`];
    if (domain) shops.push(domain);
  }
  return shops;
}

const tokenCache = {};

async function getAccessToken(shopDomain) {
  const now = Date.now();
  const cached = tokenCache[shopDomain];
  if (cached && now - cached.obtainedAt < 23 * 60 * 60 * 1000) {
    return cached.token;
  }

  const url = `https://${shopDomain}/admin/oauth/access_token`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`Erreur token pour ${shopDomain}: ${response.status} - ${text}`);
    return null;
  }

  const data = await response.json();
  const token = data.access_token;
  tokenCache[shopDomain] = { token, obtainedAt: now };
  console.log(`Token obtenu pour ${shopDomain}`);
  return token;
}

async function getShopRevenue(shopDomain) {
  const token = await getAccessToken(shopDomain);
  if (!token) return 0;

  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1).toISOString();

  let totalRevenue = 0;
  let nextPageUrl = null;
  let isFirstRequest = true;

  while (isFirstRequest || nextPageUrl) {
    isFirstRequest = false;

    let url;
    if (nextPageUrl) {
      url = nextPageUrl;
    } else {
      url =
        `https://${shopDomain}/admin/api/2024-01/orders.json` +
        `?status=any` +
        `&financial_status=paid,partially_refunded` +
        `&created_at_min=${startOfYear}` +
        `&fields=total_price` +
        `&limit=250`;
    }

    try {
      const response = await fetch(url, {
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        console.error(`Erreur ${response.status} pour ${shopDomain}`);
        break;
      }

      const data = await response.json();
      const orders = data.orders || [];

      for (const order of orders) {
        totalRevenue += parseFloat(order.total_price || 0);
      }

      const linkHeader = response.headers.get("link");
      nextPageUrl = null;
      if (linkHeader) {
        const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
        if (nextMatch) nextPageUrl = nextMatch[1];
      }
    } catch (error) {
      console.error(`Erreur pour ${shopDomain}:`, error.message);
      break;
    }
  }

  console.log(`${shopDomain}: ${totalRevenue.toFixed(2)} EUR`);
  return totalRevenue;
}

let cachedNumber = 0;
let lastFetch = 0;
const CACHE_DURATION = 60 * 1000;

async function getTotalRevenue() {
  const now = Date.now();
  if (now - lastFetch < CACHE_DURATION && cachedNumber > 0) {
    return cachedNumber;
  }

  const shops = getShopDomains();
  if (shops.length === 0) {
    console.error("Aucune boutique configuree !");
    return 0;
  }

  console.log(`\nRecuperation du CA pour ${shops.length} boutique(s)...`);
  const revenues = await Promise.all(shops.map(getShopRevenue));
  const total = revenues.reduce((sum, r) => sum + r, 0);

  cachedNumber = Math.round(total);
  lastFetch = now;
  console.log(`TOTAL: ${cachedNumber} EUR\n`);
  return cachedNumber;
}

app.get("/", async (req, res) => {
  try {
    const number = await getTotalRevenue();
    res.json({ number });
  } catch (error) {
    console.error("Erreur:", error);
    res.json({ number: cachedNumber || 0 });
  }
});

app.get("/debug", async (req, res) => {
  const shops = getShopDomains();
  const results = [];
  for (const shop of shops) {
    const revenue = await getShopRevenue(shop);
    results.push({ domain: shop, revenue: revenue.toFixed(2) });
  }
  const total = results.reduce((sum, r) => sum + parseFloat(r.revenue), 0);
  res.json({
    shops: results,
    total: total.toFixed(2),
    number: Math.round(total),
    lastUpdate: new Date().toISOString(),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const shops = getShopDomains();
  console.log(`Serveur SMIIRL demarre sur le port ${PORT}`);
  console.log(`${shops.length} boutique(s) configuree(s)`
