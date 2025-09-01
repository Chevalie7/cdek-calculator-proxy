const express = require('express');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const CDEK_OAUTH_URL = 'https://api.cdek.ru/v2/oauth/token';
const CDEK_API_BASE = 'https://api.cdek.ru/v2';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

let cachedToken = null;
let cachedUntil = 0;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

async function getToken() {
  const now = Date.now();
  if (cachedToken && now < cachedUntil) return cachedToken;

  const response = await fetch(CDEK_OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.CDEK_CLIENT_ID,
      client_secret: process.env.CDEK_CLIENT_SECRET
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(`Ошибка авторизации: ${JSON.stringify(data)}`);

  cachedToken = data.access_token;
  cachedUntil = Date.now() + 50 * 60 * 1000;
  return cachedToken;
}

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'cdek-proxy', routes: ['/calc', '/cities'] });
});

app.get('/cities', async (req, res) => {
  try {
    const token = await getToken();
    const params = new URLSearchParams();
    if (req.query.country_code) params.set('country_code', req.query.country_code);
    if (req.query.city) params.set('city', req.query.city);

    const response = await fetch(`${CDEK_API_BASE}/location/cities?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const data = await response.json();
    res.status(response.ok ? 200 : response.status).json(data);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/calc', async (req, res) => {
  try {
    const { from_code, to_code, weight, length, width, height, tariff_code } = req.body;

    if (!from_code || !to_code || !weight || !tariff_code) {
      return res.status(400).json({ ok: false, error: 'Отсутствуют обязательные параметры' });
    }

    const token = await getToken();

    const payload = {
      type: 1,
      currency: 1,
      tariff_code,
      from_location: { code: Number(from_code) },
      to_location: { code: Number(to_code) },
      packages: [{
        weight: Number(weight),
        length: Number(length || 0),
        width: Number(width || 0),
        height: Number(height || 0)
      }]
    };

    const response = await fetch(`${CDEK_API_BASE}/calculator/tariff`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ ok: false, error: data });

    res.json({
      ok: true,
      tariff_code: data.tariff_code,
      tariff_name: data.tariff_name,
      delivery_sum: data.delivery_sum,
      period_min: data.period_min,
      period_max: data.period_max
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => console.log(`CDEK proxy running on port ${PORT}`));
