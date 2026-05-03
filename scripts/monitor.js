const axios = require('axios');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'goranruter1@gmail.com';
const MIN_DEAL_SCORE = parseInt(process.env.MIN_DEAL_SCORE || '100');
const MIN_PRICE = parseInt(process.env.MIN_PRICE || '10000');

const SEEN_FILE = path.join(__dirname, '../seen_listings.json');

const SEARCHES = [
  { brand: 'volkswagen', model: 'golf', label: 'VW Golf' },
  { brand: 'volkswagen', model: 'passat', label: 'VW Passat' },
  { brand: 'bmw', model: 'serija-3', label: 'BMW Serija 3' },
  { brand: 'bmw', model: 'serija-5', label: 'BMW Serija 5' },
  { brand: 'audi', model: 'a4', label: 'Audi A4' },
  { brand: 'audi', model: 'a6', label: 'Audi A6' },
  { brand: 'mercedes-benz', model: 'c-klasa', label: 'Mercedes C' },
  { brand: 'mercedes-benz', model: 'e-klasa', label: 'Mercedes E' },
  { brand: 'skoda', model: 'octavia', label: 'Skoda Octavia' },
  { brand: 'toyota', model: 'camry', label: 'Toyota Camry' },
  { brand: 'toyota', model: 'rav4', label: 'Toyota RAV4' },
  { brand: 'ford', model: 'focus', label: 'Ford Focus' },
  { brand: 'opel', model: 'insignia', label: 'Opel Insignia' },
  { brand: 'hyundai', model: 'tucson', label: 'Hyundai Tucson' },
  { brand: 'kia', model: 'sportage', label: 'Kia Sportage' },
  { brand: 'mazda', model: 'cx-5', label: 'Mazda CX-5' },
  { brand: 'peugeot', model: '508', label: 'Peugeot 508' },
  { brand: 'renault', model: 'megane', label: 'Renault Megane' },
];

function loadSeen() {
  try {
    return JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveSeen(seen) {
  fs.writeFileSync(SEEN_FILE, JSON.stringify(seen, null, 2));
}

async function fetchListingsPage(search, page, last24h = false) {
  const url = last24h
    ? `https://www.polovniautomobili.com/auto-oglasi/poslednja24h?brand=${search.brand}&model=${search.model}&price_from=${MIN_PRICE}&page=${page}`
    : `https://www.polovniautomobili.com/auto-oglasi/pretraga?brand=${search.brand}&model=${search.model}&price_from=${MIN_PRICE}&sort=date_desc&showOldNew=all&page=${page}`;

  const prompt = `Pretraži URL: ${url}

Izvuci SVE oglase automobila sa te stranice. Za svaki oglas vrati JSON sa:
- id: jedinstveni string (kombiniraj marku+model+cenu+km+godiste)
- title: naziv oglasa
- price: cena u EUR (broj, samo broj bez simbola)
- year: godina (broj)
- km: kilometraža (broj)
- engine: motor/zapremina
- location: grad
- link: direktan link ka oglasu

Vrati SAMO JSON array, bez objašnjenja. Ako ne možeš pristupiti URL-u, vrati [].`;

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        timeout: 90000,
      }
    );

    let text = '';
    for (const block of response.data.content || []) {
      if (block.type === 'text') text += block.text;
    }

    const clean = text.replace(/```json|```/g, '').trim();
    const match = clean.match(/\[[\s\S]+\]/);
    if (!match) return [];

    return JSON.parse(match[0])
      .filter((l) => l.price && l.price >= MIN_PRICE)
      .map((l) => ({ ...l, searchLabel: search.label }));
  } catch (err) {
    console.error(`  Error page ${page}:`, err.message);
    if (err.response) console.error('  API:', JSON.stringify(err.response.data));
    return [];
  }
}

function calcMedian(prices) {
  const sorted = [...prices].sort((a, b) => a - b);
  const cut = Math.floor(sorted.length * 0.1);
  const trimmed = sorted.slice(cut, sorted.length - cut || undefined);
  return trimmed[Math.floor(trimmed.length / 2)];
}

function scoreListing(listing, allListings) {
  const year = listing.year || 0;
  const km = listing.km || 0;
  const others = allListings.filter((l) => l.id !== listing.id && l.price >= MIN_PRICE);

  // 1. Najuži filter: isto godište ±2 + slična kilometraža ±40%
  let pool = others.filter((l) => {
    const yearOk = !year || !l.year || Math.abs(l.year - year) <= 2;
    const kmOk = !km || !l.km || (l.km >= km * 0.6 && l.km <= km * 1.4);
    return yearOk && kmOk;
  });

  let poolDesc = `${pool.length} oglasa (±2 god, slična km)`;

  // 2. Fallback: samo godište ±3
  if (pool.length < 4) {
    pool = others.filter((l) => !year || !l.year || Math.abs(l.year - year) <= 3);
    poolDesc = `${pool.length} oglasa (±3 god)`;
  }

  // 3. Fallback: svi oglasi tog modela
  if (pool.length < 3) {
    pool = others;
    poolDesc = `${pool.length} oglasa modela`;
  }

  if (pool.length === 0) {
    return { dealScore: 50, marketAvg: null, savings: 0, reason: 'Nedovoljno podataka za poređenje.' };
  }

  const median = calcMedian(pool.map((l) => l.price));
  const savings = median - listing.price;
  const deviationPct = savings / median;

  // 50 = na medijanu, +25 za svakih 10% ispod medijana, max 100
  const dealScore = Math.min(100, Math.max(0, Math.round(50 + deviationPct * 250)));

  const direction = savings > 0 ? 'ispod' : 'iznad';
  const reason =
    `Cena ${listing.price.toLocaleString('de-DE')}€ je ${Math.abs(Math.round(deviationPct * 100))}% ` +
    `${direction} medijana (${median.toLocaleString('de-DE')}€) ` +
    `na osnovu ${poolDesc} sa sličnim godištem${km ? ' i kilometražom' : ''}.`;

  return { dealScore, marketAvg: median, savings, reason };
}

function buildEmailHtml(deals) {
  const rows = deals
    .sort((a, b) => b.dealScore - a.dealScore)
    .map(
      (d) => `
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 12px 8px;">
        <strong style="color: #1a1a2e;">${d.title}</strong><br>
        <span style="font-size: 12px; color: #666;">${d.searchLabel} · ${d.year || '?'} · ${d.km ? d.km.toLocaleString('de-DE') + ' km' : '?'}</span>
      </td>
      <td style="padding: 12px 8px; text-align: center;">
        <span style="
          background: ${d.dealScore >= 80 ? '#00c853' : '#ff9100'};
          color: white; padding: 4px 10px; border-radius: 20px;
          font-weight: bold; font-size: 14px;
        ">${d.dealScore}/100</span>
      </td>
      <td style="padding: 12px 8px; text-align: right;">
        <strong style="font-size: 16px; color: #1a1a2e;">${d.price?.toLocaleString('de-DE')} €</strong><br>
        ${d.marketAvg ? `<span style="font-size: 12px; color: #999;">Median: ${d.marketAvg.toLocaleString('de-DE')} €</span>` : ''}
      </td>
      <td style="padding: 12px 8px; text-align: center;">
        ${d.savings > 0 ? `<strong style="color: #00c853;">▼ ${d.savings.toLocaleString('de-DE')} €</strong>` : ''}
      </td>
      <td style="padding: 12px 8px; font-size: 12px; color: #555; max-width: 220px;">
        ${d.reason}
      </td>
      <td style="padding: 12px 8px; text-align: center;">
        ${d.link ? `<a href="${d.link}" style="color: #0066cc; font-size: 12px;">Pogledaj →</a>` : '-'}
      </td>
    </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 900px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <div style="background: linear-gradient(135deg, #1a1a2e, #16213e); padding: 24px 32px;">
      <h1 style="margin: 0; color: white; font-size: 22px;">Nova Top Ponuda!</h1>
      <p style="margin: 8px 0 0; color: #aaa; font-size: 14px;">
        ${deals.length} oglasa sa Deal Score ≥ ${MIN_DEAL_SCORE} · ${new Date().toLocaleString('sr-RS')}
        · Cene poređene sa stvarnim medijanom sa sajta
      </p>
    </div>
    <div style="padding: 24px 32px;">
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="background: #f8f8f8; border-bottom: 2px solid #ddd;">
            <th style="padding: 10px 8px; text-align: left; font-size: 12px; color: #666; text-transform: uppercase;">Oglas</th>
            <th style="padding: 10px 8px; text-align: center; font-size: 12px; color: #666; text-transform: uppercase;">Score</th>
            <th style="padding: 10px 8px; text-align: right; font-size: 12px; color: #666; text-transform: uppercase;">Cena</th>
            <th style="padding: 10px 8px; text-align: center; font-size: 12px; color: #666; text-transform: uppercase;">Uštedina</th>
            <th style="padding: 10px 8px; font-size: 12px; color: #666; text-transform: uppercase;">Analiza</th>
            <th style="padding: 10px 8px; text-align: center; font-size: 12px; color: #666; text-transform: uppercase;">Link</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="padding: 16px 32px; background: #f8f8f8; border-top: 1px solid #eee; font-size: 11px; color: #999;">
      Automatski monitoring · polovniautomobili.rs · Min cena: ${MIN_PRICE.toLocaleString('de-DE')} € · Min score: ${MIN_DEAL_SCORE} · Score baziran na stvarnim cenama sa sajta
    </div>
  </div>
</body>
</html>`;
}

async function sendEmail(deals) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });

  await transporter.sendMail({
    from: `"Auto Monitor" <${GMAIL_USER}>`,
    to: NOTIFY_EMAIL,
    subject: `${deals.length} nova top ponuda na polovniautomobili.rs (Score ${MIN_DEAL_SCORE}+)`,
    html: buildEmailHtml(deals),
  });

  console.log(`Email sent to ${NOTIFY_EMAIL} with ${deals.length} deals`);
}

async function main() {
  console.log(`\n=== Auto Monitor Start: ${new Date().toISOString()} ===`);
  console.log(`Min price: ${MIN_PRICE}€ | Min deal score: ${MIN_DEAL_SCORE} | Searches: ${SEARCHES.length}`);

  const seen = loadSeen();
  const newDeals = [];

  for (const search of SEARCHES) {
    console.log(`\nFetching: ${search.label}`);

    // Fetch new listings from last 24h + 2 pages of regular search for baseline
    const [newListings, basePage1, basePage2] = await Promise.all([
      fetchListingsPage(search, 1, true),
      fetchListingsPage(search, 1, false),
      fetchListingsPage(search, 2, false),
    ]);

    const baselineListings = [...basePage1, ...basePage2];
    const allListings = [...newListings, ...baselineListings];

    if (allListings.length === 0) {
      console.log(`  Nema oglasa.`);
      continue;
    }

    console.log(`  Novi (24h): ${newListings.length} | Baseline: ${baselineListings.length}`);

    const unseenFromPage1 = newListings.filter((l) => !seen[l.id]);
    console.log(`  Novih (neviđenih): ${unseenFromPage1.length}`);

    for (const listing of unseenFromPage1) {
      const { dealScore, marketAvg, savings, reason } = scoreListing(listing, allListings);
      console.log(`    ${listing.title}: score=${dealScore}, cena=${listing.price}€, median=${marketAvg}€`);

      if (dealScore >= MIN_DEAL_SCORE) {
        newDeals.push({ ...listing, dealScore, marketAvg, savings, reason });
      }
    }

    // Mark all fetched as seen
    for (const l of [...newListings, ...baselineListings]) {
      if (!seen[l.id]) seen[l.id] = new Date().toISOString();
    }

    await new Promise((r) => setTimeout(r, 1500));
  }

  // Clean entries older than 7 days
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  for (const [id, date] of Object.entries(seen)) {
    if (date < cutoff) delete seen[id];
  }

  saveSeen(seen);

  console.log(`\nTotal top deals found: ${newDeals.length}`);

  if (newDeals.length > 0) {
    await sendEmail(newDeals);
  } else {
    console.log('Nema novih top ponuda, email se ne šalje.');
  }

  console.log('=== Done ===\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
