const axios = require('axios');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'goranruter1@gmail.com';
const MIN_DEAL_SCORE = parseInt(process.env.MIN_DEAL_SCORE || '80');
const MIN_PRICE = parseInt(process.env.MIN_PRICE || '10000');

// File to track already-seen listings (persists via git commit or cache)
const SEEN_FILE = path.join(__dirname, '../seen_listings.json');

// Search configurations - sve popularne marke
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

async function fetchListingsForSearch(search) {
  const url = `https://www.polovniautomobili.com/auto-oglasi/pretraga?brand=${search.brand}&model=${search.model}&price_from=${MIN_PRICE}&sort=date_desc&showOldNew=all&page=1`;

  console.log(`Fetching: ${search.label} - ${url}`);

  const prompt = `Pretraži URL: ${url}

Izvuci sve oglase automobila. Za svaki oglas vrati JSON sa:
- id: jedinstveni string (kombiniraj marku+model+cenu+km)
- title: naziv oglasa
- price: cena u EUR (broj)
- year: godina (broj)
- km: kilometraža (broj)
- engine: motor/zapremina
- location: grad
- link: direktan link ka oglasu

Vrati SAMO JSON array. Ako ne možeš pristupiti URL-u, vrati prazan array [].`;

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        timeout: 60000,
      }
    );

    let text = '';
    for (const block of response.data.content || []) {
      if (block.type === 'text') text += block.text;
    }

    const clean = text.replace(/```json|```/g, '').trim();
    const match = clean.match(/\[[\s\S]+\]/);
    if (!match) return [];

    const listings = JSON.parse(match[0]);
    return listings
      .filter((l) => l.price && l.price >= MIN_PRICE)
      .map((l) => ({ ...l, searchLabel: search.label }));
  } catch (err) {
    console.error(`Error fetching ${search.label}:`, err.message);
    if (err.response) console.error('API response:', JSON.stringify(err.response.data));
    return [];
  }
}

async function analyzeDeals(listings) {
  if (!listings.length) return [];

  const prompt = `Analiziraj ${listings.length} oglasa automobila sa srpskog tržišta i proceni deal score.

Oglasi:
${JSON.stringify(listings, null, 2)}

Za SVAKI oglas vrati JSON array:
- id: isti id kao u ulazu
- dealScore: 0-100 (100 = neverovatna kupovina ispod tržišne cene)
- marketAvg: procenjena tržišna vrednost u EUR
- savings: uštedina vs tržišna vrednost (može biti negativno)
- reason: 1-2 rečenice na srpskom

Uzmi u obzir: cenu vs. tržišni prosek za taj model/godište/km u Srbiji, stanje, km, motor.

Vrati SAMO JSON array.`;

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        timeout: 60000,
      }
    );

    const text = response.data.content?.find((c) => c.type === 'text')?.text || '[]';
    const clean = text.replace(/```json|```/g, '').trim();
    const match = clean.match(/\[[\s\S]+\]/);
    if (!match) return [];

    const analysis = JSON.parse(match[0]);

    return listings.map((listing) => {
      const ai = analysis.find((a) => a.id === listing.id) || {};
      return {
        ...listing,
        dealScore: ai.dealScore ?? 50,
        marketAvg: ai.marketAvg ?? null,
        savings: ai.savings ?? 0,
        reason: ai.reason ?? '',
      };
    });
  } catch (err) {
    console.error('Analysis error:', err.message);
    return listings.map((l) => ({ ...l, dealScore: 50 }));
  }
}

function buildEmailHtml(deals) {
  const rows = deals
    .sort((a, b) => b.dealScore - a.dealScore)
    .map(
      (d) => `
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 12px 8px;">
        <strong style="color: #1a1a2e;">${d.title}</strong><br>
        <span style="font-size: 12px; color: #666;">${d.searchLabel}</span>
      </td>
      <td style="padding: 12px 8px; text-align: center;">
        <span style="
          background: ${d.dealScore >= 80 ? '#00c853' : '#ff9100'};
          color: white;
          padding: 4px 10px;
          border-radius: 20px;
          font-weight: bold;
          font-size: 14px;
        ">${d.dealScore}/100</span>
      </td>
      <td style="padding: 12px 8px; text-align: right;">
        <strong style="font-size: 16px; color: #1a1a2e;">${d.price?.toLocaleString('de-DE')} €</strong><br>
        ${d.marketAvg ? `<span style="font-size: 12px; color: #999;">Tržišno: ${d.marketAvg.toLocaleString('de-DE')} €</span>` : ''}
      </td>
      <td style="padding: 12px 8px; text-align: center;">
        ${d.savings > 0 ? `<strong style="color: #00c853;">▼ ${d.savings.toLocaleString('de-DE')} €</strong>` : ''}
      </td>
      <td style="padding: 12px 8px; font-size: 12px; color: #555; max-width: 200px;">
        ${d.reason}
      </td>
      <td style="padding: 12px 8px; text-align: center;">
        ${d.link ? `<a href="${d.link}" style="color: #0066cc; font-size: 12px;">Pogledaj →</a>` : '-'}
      </td>
    </tr>`
    )
    .join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 900px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    
    <div style="background: linear-gradient(135deg, #1a1a2e, #16213e); padding: 24px 32px;">
      <h1 style="margin: 0; color: white; font-size: 22px;">🚗 Nova Top Ponuda!</h1>
      <p style="margin: 8px 0 0; color: #aaa; font-size: 14px;">
        Pronađeno ${deals.length} oglasa sa Deal Score ≥ ${MIN_DEAL_SCORE} · ${new Date().toLocaleString('sr-RS')}
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
            <th style="padding: 10px 8px; font-size: 12px; color: #666; text-transform: uppercase;">AI Analiza</th>
            <th style="padding: 10px 8px; text-align: center; font-size: 12px; color: #666; text-transform: uppercase;">Link</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <div style="padding: 16px 32px; background: #f8f8f8; border-top: 1px solid #eee; font-size: 11px; color: #999;">
      Automatski monitoring · polovniautomobili.rs · Minimum cena: ${MIN_PRICE.toLocaleString('de-DE')} € · Minimum deal score: ${MIN_DEAL_SCORE}
    </div>
  </div>
</body>
</html>`;
}

async function sendEmail(deals) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: `"🚗 Auto Monitor" <${GMAIL_USER}>`,
    to: NOTIFY_EMAIL,
    subject: `🔥 ${deals.length} nova top ponuda na polovniautomobili.rs (Score 80+)`,
    html: buildEmailHtml(deals),
  });

  console.log(`Email sent to ${NOTIFY_EMAIL} with ${deals.length} deals`);
}

async function main() {
  console.log(`\n=== Auto Monitor Start: ${new Date().toISOString()} ===`);
  console.log(`Min price: ${MIN_PRICE}€ | Min deal score: ${MIN_DEAL_SCORE} | Searches: ${SEARCHES.length}`);

  const seen = loadSeen();
  const newDeals = [];

  // Fetch listings in batches to avoid rate limits
  for (const search of SEARCHES) {
    const listings = await fetchListingsForSearch(search);
    if (!listings.length) continue;

    // Filter out already seen
    const unseen = listings.filter((l) => !seen[l.id]);
    if (!unseen.length) {
      console.log(`  ${search.label}: sve već viđeno`);
      continue;
    }

    console.log(`  ${search.label}: ${unseen.length} novih oglasa, analiziram...`);

    // Analyze in batches of 10
    const batch = unseen.slice(0, 10);
    const analyzed = await analyzeDeals(batch);

    const topDeals = analyzed.filter((l) => l.dealScore >= MIN_DEAL_SCORE);
    newDeals.push(...topDeals);

    // Mark all fetched as seen
    for (const l of listings) {
      seen[l.id] = new Date().toISOString();
    }

    // Small delay between searches
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Clean old seen entries (older than 7 days)
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
