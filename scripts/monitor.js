const { chromium } = require('playwright');
const cheerio = require('cheerio');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'goranruter1@gmail.com';
const MIN_DEAL_SCORE = parseInt(process.env.MIN_DEAL_SCORE || '90');
const MIN_PRICE = parseInt(process.env.MIN_PRICE || '10000');
const MAX_PRICE = parseInt(process.env.MAX_PRICE || '20000');
const MIN_YEAR = parseInt(process.env.MIN_YEAR || '2015');

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

let browser = null;
let browserContext = null;

async function initBrowser() {
  browser = await chromium.launch({ headless: true });
  browserContext = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'sr-RS',
    timezoneId: 'Europe/Belgrade',
    viewport: { width: 1280, height: 800 },
  });
  // Warm up session by visiting homepage first
  const page = await browserContext.newPage();
  await page.goto('https://www.polovniautomobili.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.close();
  console.log('Browser session initialized.');
}

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

function parsePrice(str) {
  if (!str) return null;
  const num = parseInt(str.replace(/[^\d]/g, ''));
  return isNaN(num) ? null : num;
}

function parseKm(str) {
  if (!str) return null;
  const num = parseInt(str.replace(/[^\d]/g, ''));
  return isNaN(num) ? null : num;
}

function parseYear(str) {
  if (!str) return null;
  const match = str.match(/\b(19|20)\d{2}\b/);
  return match ? parseInt(match[0]) : null;
}

function detectFuel(text) {
  const t = text.toLowerCase();
  if (/elektr|ev\b|bev/.test(t)) return 'electric';
  if (/hibrid|hybrid|phev|hev/.test(t)) return 'hybrid';
  if (/tdi|cdi|hdi|dci|crdi|jtd|dizel|diesel|bluemotion|cdti/.test(t)) return 'diesel';
  if (/tsi|tfsi|fsi|gti|gsi|benzin|petrol|mpi|turbo benzin/.test(t)) return 'petrol';
  return null;
}

function detectTransmission(text) {
  const t = text.toLowerCase();
  if (/dsg|automat|automatik|tiptronic|cvt|s.tronic|pdk|xtronic|automatski/.test(t)) return 'automatic';
  if (/manuelni|manuelna|manuelni|6-brzin|5-brzin|manual/.test(t)) return 'manual';
  return null;
}

// Returns months of registration remaining from text like "Registracija: 05.2027"
function parseRegistrationMonths(text) {
  const match = text.match(/registr[a-z]*[:\s]+(\d{2})\.(\d{4})/i);
  if (!match) return 0;
  const regMonth = parseInt(match[1]);
  const regYear = parseInt(match[2]);
  const now = new Date();
  const months = (regYear - now.getFullYear()) * 12 + (regMonth - now.getMonth() - 1);
  return Math.max(0, months);
}

// ~80€/month is rough registration cost in Serbia
const REG_VALUE_PER_MONTH = 80;

async function fetchPage(url) {
  const page = await browserContext.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500); // let JS render
    return await page.content();
  } finally {
    await page.close();
  }
}

function parseListings(html, search) {
  const $ = cheerio.load(html);
  const listings = [];

  // Log a snippet of the HTML on first parse attempt to help debug selectors
  const bodySnippet = $('body').html()?.slice(0, 500) || '';
  console.log(`  HTML snippet: ${bodySnippet.replace(/\s+/g, ' ').slice(0, 300)}`);

  // Try multiple selector strategies
  const candidateSelectors = [
    'article.classified-item',
    'article[class*="classified"]',
    'article[class*="oglas"]',
    '.classified-item',
    '.oglas',
    'article',
    '[data-classifiedid]',
    '[data-ad-id]',
    '.js-adClick',
  ];

  let items = null;
  let usedSelector = '';

  for (const sel of candidateSelectors) {
    const found = $(sel);
    if (found.length > 0) {
      items = found;
      usedSelector = sel;
      break;
    }
  }

  if (!items || items.length === 0) {
    console.log(`  No listing elements found. Trying JSON-LD...`);

    // Try JSON-LD structured data
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).html());
        const arr = Array.isArray(data) ? data : [data];
        for (const item of arr) {
          if (item['@type'] === 'Car' || item['@type'] === 'Product') {
            const price = item.offers?.price || item.price;
            listings.push({
              id: `${search.brand}-${search.model}-${price}-ld`,
              title: item.name || '',
              price: parsePrice(String(price)),
              year: parseYear(item.vehicleModelDate || item.productionDate || ''),
              km: parseKm(item.mileageFromOdometer?.value || ''),
              engine: item.vehicleEngine?.engineDisplacement || '',
              location: item.availableAtOrFrom?.name || '',
              link: item.url || '',
              searchLabel: search.label,
            });
          }
        }
      } catch {}
    });

    return listings;
  }

  console.log(`  Found ${items.length} items with selector: "${usedSelector}"`);

  items.each((i, el) => {
    const $el = $(el);

    const link = $el.find('a').first().attr('href') || $el.attr('href') || '';
    const fullLink = link.startsWith('http') ? link : `https://www.polovniautomobili.com${link}`;

    const title = $el.find('h2, h3, .title, [class*="title"], [class*="naziv"]').first().text().trim()
      || $el.find('a').first().text().trim();

    // Price: look for € sign or "EUR" or dedicated price element
    const priceEl = $el.find('[class*="price"], [class*="cena"], [class*="Price"]').first();
    const priceText = priceEl.text() || $el.text().match(/[\d\.\s]+\s*€/)?.[0] || '';
    const price = parsePrice(priceText);

    // Year and km from detail rows or text
    const detailText = $el.find('[class*="detail"], [class*="info"], [class*="param"], table, .details').text();
    const allText = $el.text();

    const year = parseYear(detailText) || parseYear(allText);
    const kmMatch = (detailText + allText).match(/\b(\d{1,3}(?:[.\s]\d{3}){0,1})\s*km\b/i);
    const km = kmMatch ? parseKm(kmMatch[1]) : null;

    const engine = $el.find('[class*="engine"], [class*="motor"]').first().text().trim() || '';
    const location = $el.find('[class*="location"], [class*="lokacija"], [class*="city"], [class*="grad"]').first().text().trim() || '';

    if (!price || price < MIN_PRICE || price > MAX_PRICE) return;
    if (year && year < MIN_YEAR) return;

    const image = $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src') || null;
    const fullText = `${title} ${engine} ${detailText} ${allText}`;
    const fuel = detectFuel(fullText);
    const transmission = detectTransmission(fullText);
    const regMonths = parseRegistrationMonths(fullText);
    const regBonus = regMonths * REG_VALUE_PER_MONTH;

    const id = `${search.brand}-${search.model}-${price}-${km || 0}-${year || 0}`;
    listings.push({ id, title, price, year, km, engine, location, link: fullLink, image, fuel, transmission, regMonths, regBonus, searchLabel: search.label });
  });

  return listings;
}

async function fetchListings(search, last24h = false) {
  const url = last24h
    ? `https://www.polovniautomobili.com/auto-oglasi/poslednja24h?brand=${search.brand}&model=${search.model}&price_from=${MIN_PRICE}&price_to=${MAX_PRICE}&year_from=${MIN_YEAR}&year_to=&modeltxt=&showOldNew=all&country=&city=&submit_1=&page=&sort=`
    : `https://www.polovniautomobili.com/auto-oglasi/pretraga?brand=${search.brand}&model=${search.model}&price_from=${MIN_PRICE}&price_to=${MAX_PRICE}&year_from=${MIN_YEAR}&sort=date_desc&showOldNew=all&page=1`;

  try {
    const html = await fetchPage(url);
    return parseListings(html, search);
  } catch (err) {
    console.error(`  Fetch error: ${err.message}`);
    return [];
  }
}

async function fetchBaseline(search) {
  const results = [];
  for (const page of [1, 2]) {
    const url = `https://www.polovniautomobili.com/auto-oglasi/pretraga?brand=${search.brand}&model=${search.model}&price_from=${MIN_PRICE}&price_to=${MAX_PRICE}&year_from=${MIN_YEAR}&sort=date_desc&showOldNew=all&page=${page}`;
    try {
      const html = await fetchPage(url);
      const listings = parseListings(html, search);
      results.push(...listings);
    } catch (err) {
      console.error(`  Baseline page ${page} error: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return results;
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
  const fuel = listing.fuel;
  const transmission = listing.transmission;
  const others = allListings.filter((l) => l.id !== listing.id && l.price >= MIN_PRICE);

  const yearOk = (l) => !year || !l.year || Math.abs(l.year - year) <= 2;
  const kmOk = (l) => !km || !l.km || (l.km >= km * 0.6 && l.km <= km * 1.4);
  const fuelOk = (l) => !fuel || !l.fuel || l.fuel === fuel;
  const transOk = (l) => !transmission || !l.transmission || l.transmission === transmission;

  // 1. Best: year ±2, km ±40%, same fuel, same transmission
  let pool = others.filter((l) => yearOk(l) && kmOk(l) && fuelOk(l) && transOk(l));
  let poolDesc = `${pool.length} oglasa (god, km, gorivo, menjač)`;

  // 2. Drop transmission filter
  if (pool.length < 4) {
    pool = others.filter((l) => yearOk(l) && kmOk(l) && fuelOk(l));
    poolDesc = `${pool.length} oglasa (god, km, gorivo)`;
  }

  // 3. Drop fuel filter
  if (pool.length < 4) {
    pool = others.filter((l) => yearOk(l) && kmOk(l));
    poolDesc = `${pool.length} oglasa (god ±2, slična km)`;
  }

  // 4. Widen year
  if (pool.length < 4) {
    pool = others.filter((l) => !year || !l.year || Math.abs(l.year - year) <= 3);
    poolDesc = `${pool.length} oglasa (god ±3)`;
  }

  // 5. All
  if (pool.length < 3) {
    pool = others;
    poolDesc = `${pool.length} oglasa modela`;
  }

  if (pool.length === 0) {
    return { dealScore: 50, marketAvg: null, savings: 0, reason: 'Nedovoljno podataka.' };
  }

  const median = calcMedian(pool.map((l) => l.price));

  // Effective price adjusts for included registration value
  const regBonus = listing.regBonus || 0;
  const effectivePrice = listing.price - regBonus;
  const savings = median - effectivePrice;
  const deviationPct = savings / median;

  const dealScore = Math.min(100, Math.max(0, Math.round(50 + deviationPct * 250)));

  const direction = savings > 0 ? 'ispod' : 'iznad';
  const fuelLabel = { diesel: 'dizel', petrol: 'benzin', hybrid: 'hibrid', electric: 'struja' }[fuel] || '';
  const transLabel = { automatic: 'automatik', manual: 'manuelni' }[transmission] || '';
  const extras = [fuelLabel, transLabel].filter(Boolean).join(', ');
  const regNote = regBonus > 0 ? ` + ${listing.regMonths} mes. registracije (≈${regBonus}€)` : '';

  const reason =
    `Efektivna cena ${effectivePrice.toLocaleString('de-DE')}€${regNote} je ${Math.abs(Math.round(deviationPct * 100))}% ` +
    `${direction} medijana (${median.toLocaleString('de-DE')}€) ` +
    `na osnovu ${poolDesc}${extras ? ` [${extras}]` : ''}.`;

  return { dealScore, marketAvg: median, savings: Math.round(savings), reason };
}

function buildEmailHtml(deals) {
  const rows = deals
    .sort((a, b) => b.dealScore - a.dealScore)
    .map(
      (d) => `
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 12px 8px; width: 90px;">
        ${d.image ? `<img src="${d.image}" style="width:80px;height:60px;object-fit:cover;border-radius:4px;" />` : '<div style="width:80px;height:60px;background:#eee;border-radius:4px;"></div>'}
      </td>
      <td style="padding: 12px 8px;">
        <strong>${d.title}</strong><br>
        <span style="font-size: 12px; color: #666;">
          ${d.searchLabel} · ${d.year || '?'} · ${d.km ? d.km.toLocaleString('de-DE') + ' km' : '?'} · ${d.engine || '?'}
          ${d.fuel ? `· <strong>${{diesel:'⛽ Dizel',petrol:'⛽ Benzin',hybrid:'🔋 Hibrid',electric:'⚡ Struja'}[d.fuel]}</strong>` : ''}
          ${d.transmission ? `· ${{automatic:'🔄 Automat',manual:'⚙️ Manuelni'}[d.transmission]}` : ''}
          ${d.regMonths > 0 ? `· 📋 Reg. još ${d.regMonths} mes.` : ''}
        </span>
      </td>
      <td style="padding: 12px 8px; text-align: center;">
        <span style="background:${d.dealScore >= 80 ? '#00c853' : '#ff9100'};color:white;padding:4px 10px;border-radius:20px;font-weight:bold;">${d.dealScore}/100</span>
      </td>
      <td style="padding: 12px 8px; text-align: right;">
        <strong>${d.price?.toLocaleString('de-DE')} €</strong><br>
        ${d.marketAvg ? `<span style="font-size:12px;color:#999;">Median: ${d.marketAvg.toLocaleString('de-DE')} €</span>` : ''}
      </td>
      <td style="padding: 12px 8px; text-align: center; color: #00c853;">
        ${d.savings > 0 ? `▼ ${d.savings.toLocaleString('de-DE')} €` : ''}
      </td>
      <td style="padding: 12px 8px; font-size: 12px; color: #555;">${d.reason}</td>
      <td style="padding: 12px 8px; text-align: center;">
        ${d.link ? `<a href="${d.link}" style="color:#0066cc;">Pogledaj →</a>` : '-'}
      </td>
    </tr>`
    )
    .join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px;">
  <div style="max-width:900px;margin:0 auto;background:white;border-radius:8px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:24px 32px;">
      <h1 style="margin:0;color:white;">Nova Top Ponuda!</h1>
      <p style="margin:8px 0 0;color:#aaa;font-size:14px;">${deals.length} oglasa · score ≥ ${MIN_DEAL_SCORE} · ${new Date().toLocaleString('sr-RS')} · Real market data</p>
    </div>
    <div style="padding:24px 32px;">
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="background:#f8f8f8;border-bottom:2px solid #ddd;">
          <th style="padding:10px 8px;font-size:12px;color:#666;">SLIKA</th>
          <th style="padding:10px 8px;text-align:left;font-size:12px;color:#666;">OGLAS</th>
          <th style="padding:10px 8px;font-size:12px;color:#666;">SCORE</th>
          <th style="padding:10px 8px;text-align:right;font-size:12px;color:#666;">CENA</th>
          <th style="padding:10px 8px;font-size:12px;color:#666;">UŠTEDINA</th>
          <th style="padding:10px 8px;font-size:12px;color:#666;">ANALIZA</th>
          <th style="padding:10px 8px;font-size:12px;color:#666;">LINK</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>
</body></html>`;
}

async function sendEmail(deals) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
  await transporter.sendMail({
    from: `"Auto Monitor" <${GMAIL_USER}>`,
    to: NOTIFY_EMAIL,
    subject: `${deals.length} top ponuda na polovniautomobili.rs (Score ${MIN_DEAL_SCORE}+)`,
    html: buildEmailHtml(deals),
  });
  console.log(`Email sent to ${NOTIFY_EMAIL} with ${deals.length} deals`);
}

async function main() {
  console.log(`\n=== Auto Monitor Start: ${new Date().toISOString()} ===`);
  console.log(`Min price: ${MIN_PRICE}€ | Min deal score: ${MIN_DEAL_SCORE} | Searches: ${SEARCHES.length}`);

  await initBrowser();

  const seen = loadSeen();
  const newDeals = [];

  for (const search of SEARCHES) {
    console.log(`\nFetching: ${search.label}`);

    const [newListings, baselineListings] = await Promise.all([
      fetchListings(search, true),
      fetchBaseline(search),
    ]);

    const allListings = [...newListings, ...baselineListings];
    console.log(`  Novi (24h): ${newListings.length} | Baseline: ${baselineListings.length}`);

    if (allListings.length === 0) continue;

    // Show listing if unseen OR if price changed since last time
    const toScore = newListings.filter((l) => {
      const prev = seen[l.id];
      if (!prev) return true;
      return prev.price !== l.price; // price changed — re-evaluate
    });
    console.log(`  Za analizu: ${toScore.length}`);

    for (const listing of toScore) {
      const scored = scoreListing(listing, allListings);
      console.log(`    ${listing.title}: score=${scored.dealScore}, cena=${listing.price}€, median=${scored.marketAvg}€`);
      if (scored.dealScore >= MIN_DEAL_SCORE) {
        newDeals.push({ ...listing, ...scored });
      }
    }

    for (const l of allListings) {
      seen[l.id] = { date: new Date().toISOString(), price: l.price };
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  for (const [id, val] of Object.entries(seen)) {
    const date = typeof val === 'object' ? val.date : val;
    if (date < cutoff) delete seen[id];
  }
  saveSeen(seen);

  console.log(`\nTotal top deals found: ${newDeals.length}`);
  if (newDeals.length > 0) {
    await sendEmail(newDeals);
  } else {
    console.log('Nema novih top ponuda, email se ne šalje.');
  }
  if (browser) await browser.close();
  console.log('=== Done ===\n');
}

main().catch(async (err) => {
  if (browser) await browser.close();
  console.error('Fatal error:', err);
  process.exit(1);
});
