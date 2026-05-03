const { chromium } = require('playwright');
const cheerio = require('cheerio');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const MIN_DEAL_SCORE = parseInt(process.env.MIN_DEAL_SCORE || '80');
const MIN_PRICE = parseInt(process.env.MIN_PRICE || '8000');
const MAX_PRICE = parseInt(process.env.MAX_PRICE || '12000');
const MIN_YEAR = parseInt(process.env.MIN_YEAR || '2014');

// MONITOR_TYPE: 'suv' (default) or 'cars'
const MONITOR_TYPE = (process.env.MONITOR_TYPE || 'suv').toLowerCase();
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'goranruter1@gmail.com';
const SEEN_FILE = path.join(__dirname, `../seen_${MONITOR_TYPE}.json`);

const SEARCHES_SUV = [
  { brand: 'nissan',        model: 'qashqai',   label: 'Nissan Qashqai',        keywords: ['qashqai'] },
  { brand: 'volkswagen',    model: 'tiguan',    label: 'VW Tiguan',             keywords: ['tiguan'] },
  { brand: 'skoda',         model: 'kodiaq',    label: 'Skoda Kodiaq',          keywords: ['kodiaq'] },
  { brand: 'hyundai',       model: 'tucson',    label: 'Hyundai Tucson',        keywords: ['tucson'] },
  { brand: 'kia',           model: 'sportage',  label: 'Kia Sportage',          keywords: ['sportage'] },
  { brand: 'toyota',        model: 'rav4',      label: 'Toyota RAV4',           keywords: ['rav4', 'rav 4'] },
  { brand: 'mazda',         model: 'cx-5',      label: 'Mazda CX-5',            keywords: ['cx-5', 'cx5'] },
  { brand: 'ford',          model: 'kuga',      label: 'Ford Kuga',             keywords: ['kuga'] },
  { brand: 'peugeot',       model: '3008',      label: 'Peugeot 3008',          keywords: ['3008'] },
  { brand: 'mercedes-benz', model: 'glc',       label: 'Mercedes GLC',          keywords: ['glc'] },
  { brand: 'bmw',           model: 'x3',        label: 'BMW X3',                keywords: ['x3'] },
  { brand: 'bmw',           model: 'x1',        label: 'BMW X1',                keywords: ['x1'] },
  { brand: 'audi',          model: 'q5',        label: 'Audi Q5',               keywords: ['q5'] },
  { brand: 'audi',          model: 'q3',        label: 'Audi Q3',               keywords: ['q3'] },
  { brand: 'volkswagen',    model: 'touareg',   label: 'VW Touareg',            keywords: ['touareg'] },
  { brand: 'hyundai',       model: 'ix35',      label: 'Hyundai ix35',          keywords: ['ix35'] },
  { brand: 'jeep',          model: 'compass',   label: 'Jeep Compass',          keywords: ['compass'] },
  { brand: 'mitsubishi',    model: 'outlander', label: 'Mitsubishi Outlander',  keywords: ['outlander'] },
  { brand: 'honda',         model: 'cr-v',      label: 'Honda CR-V',            keywords: ['cr-v', 'crv'] },
  { brand: 'renault',       model: 'kadjar',    label: 'Renault Kadjar',        keywords: ['kadjar'] },
];

const SEARCHES_CARS = [
  { brand: 'volkswagen',    model: 'golf',      label: 'VW Golf',               keywords: ['golf'] },
  { brand: 'volkswagen',    model: 'passat',    label: 'VW Passat',             keywords: ['passat'] },
  { brand: 'skoda',         model: 'octavia',   label: 'Skoda Octavia',         keywords: ['octavia'] },
  { brand: 'skoda',         model: 'superb',    label: 'Skoda Superb',          keywords: ['superb'] },
  { brand: 'seat',          model: 'leon',      label: 'Seat Leon',             keywords: ['leon'] },
  { brand: 'audi',          model: 'a4',        label: 'Audi A4',               keywords: ['a4'] },
  { brand: 'audi',          model: 'a6',        label: 'Audi A6',               keywords: ['a6'] },
  { brand: 'bmw',           model: 'serija-3',  label: 'BMW Serija 3',          keywords: ['serija 3', '320', '318', '316', '330', '325'] },
  { brand: 'bmw',           model: 'serija-5',  label: 'BMW Serija 5',          keywords: ['serija 5', '520', '525', '530', '518', '535'] },
  { brand: 'mercedes-benz', model: 'c-klasa',   label: 'Mercedes C',            keywords: ['c-klasa', 'c klasa', 'c180', 'c200', 'c220', 'c250'] },
  { brand: 'mercedes-benz', model: 'e-klasa',   label: 'Mercedes E',            keywords: ['e-klasa', 'e klasa', 'e200', 'e220', 'e250', 'e300'] },
  { brand: 'opel',          model: 'astra',     label: 'Opel Astra',            keywords: ['astra'] },
  { brand: 'opel',          model: 'insignia',  label: 'Opel Insignia',         keywords: ['insignia'] },
  { brand: 'ford',          model: 'focus',     label: 'Ford Focus',            keywords: ['focus'] },
  { brand: 'ford',          model: 'mondeo',    label: 'Ford Mondeo',           keywords: ['mondeo'] },
  { brand: 'renault',       model: 'megane',    label: 'Renault Megane',        keywords: ['megane'] },
  { brand: 'peugeot',       model: '308',       label: 'Peugeot 308',           keywords: ['308'] },
  { brand: 'toyota',        model: 'auris',     label: 'Toyota Auris',          keywords: ['auris'] },
  { brand: 'hyundai',       model: 'i30',       label: 'Hyundai i30',           keywords: ['i30'] },
  { brand: 'kia',           model: 'ceed',      label: 'Kia Ceed',              keywords: ['ceed'] },
];

const SEARCHES = MONITOR_TYPE === 'cars' ? SEARCHES_CARS : SEARCHES_SUV;

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

const RSD_TO_EUR = 117; // fixed exchange rate RSD → EUR
const REG_VALUE_PER_MONTH_FALLBACK = 40; // fallback if RSD price not found

// Parses "od 27.193 RSD do 31.136 RSD" → returns annual cost in EUR (average of min/max)
function parseRegistrationCostEur(text) {
  const match = text.match(/od\s+([\d\.,]+)\s*rsd\s+do\s+([\d\.,]+)\s*rsd/i);
  if (!match) return null;
  const min = parseInt(match[1].replace(/[^\d]/g, ''));
  const max = parseInt(match[2].replace(/[^\d]/g, ''));
  const avgRsd = (min + max) / 2;
  return Math.round(avgRsd / RSD_TO_EUR);
}

function calcRegBonus(regMonths, annualCostEur) {
  if (regMonths <= 0) return 0;
  const monthlyRate = annualCostEur ? annualCostEur / 12 : REG_VALUE_PER_MONTH_FALLBACK;
  return Math.round(regMonths * monthlyRate);
}

async function fetchPage(url) {
  const page = await browserContext.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    return await page.content();
  } finally {
    await page.close();
  }
}

async function fetchListingsFromPage(url, search) {
  const page = await browserContext.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    const results = await page.evaluate((params) => {
      const { brand, model, label, keywords, MIN_PRICE, MAX_PRICE, MIN_YEAR } = params;
      const listings = [];

      // Find all links pointing to individual ad pages
      const adLinks = Array.from(document.querySelectorAll('a[href*="/auto-oglasi/"]'))
        .filter(a => /\/auto-oglasi\/[^/]+\/[^/]+/.test(a.href) && !a.href.includes('pretraga') && !a.href.includes('poslednja'));

      // Get unique article containers
      const seen = new Set();
      for (const link of adLinks) {
        // Walk up to find the listing container
        let el = link;
        for (let i = 0; i < 6; i++) {
          el = el.parentElement;
          if (!el) break;
          const tag = el.tagName?.toLowerCase();
          if (tag === 'article' || tag === 'li' || (tag === 'div' && el.className && el.className.length > 5)) {
            break;
          }
        }
        if (!el || seen.has(el)) continue;
        seen.add(el);

        const text = el.innerText || '';
        const html = el.innerHTML || '';

        // Title: from heading or link text
        const heading = el.querySelector('h2, h3, h4, [class*="title"], [class*="naziv"]');
        const title = heading?.innerText?.trim() || link.innerText?.trim() || '';
        if (!title || title.length < 3) continue;

        // Keyword filter — ensure listing actually matches the intended model
        if (keywords && keywords.length > 0) {
          const titleLower = title.toLowerCase();
          if (!keywords.some(kw => titleLower.includes(kw.toLowerCase()))) continue;
        }

        // Link
        const href = link.href || '';

        // Image
        const img = el.querySelector('img');
        const image = img?.src || img?.dataset?.src || img?.getAttribute('data-lazy-src') || null;

        // Price: find € in text
        const priceMatch = text.match(/([\d\.\s]+)\s*€/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/[^\d]/g, '')) : null;
        if (!price || price < MIN_PRICE || price > MAX_PRICE) continue;

        // Year
        const yearMatch = text.match(/\b(201[5-9]|202[0-9])\b/);
        const year = yearMatch ? parseInt(yearMatch[0]) : null;
        if (year && year < MIN_YEAR) continue;

        // KM — match 3-6 digit number before "km", avoid millions
        const kmMatch = text.match(/\b(\d{2,3}(?:[.\s]\d{3})?)\s*km\b/i);
        const km = kmMatch ? parseInt(kmMatch[1].replace(/[^\d]/g, '')) : null;

        // Engine displacement and label
        const engineMatch = text.match(/\b(\d)[.,](\d)\s*([a-zA-Z]{2,5})\b/);
        const engine = engineMatch ? engineMatch[0] : '';
        const engineCC = engineMatch ? parseInt(engineMatch[1]) * 1000 + parseInt(engineMatch[2]) * 100 : null;

        // Fuel
        const t = text.toLowerCase();
        let fuel = null;
        if (/elektr|ev\b/.test(t)) fuel = 'electric';
        else if (/hibrid|hybrid|phev|hev/.test(t)) fuel = 'hybrid';
        else if (/tdi|cdi|hdi|dci|dizel|diesel|cdti/.test(t)) fuel = 'diesel';
        else if (/tsi|tfsi|fsi|benzin|petrol|mpi/.test(t)) fuel = 'petrol';

        // Filter: 1350–2000cc except hybrids/electrics (they can exceed 2000)
        if (engineCC && fuel !== 'hybrid' && fuel !== 'electric') {
          if (engineCC < 1350 || engineCC > 2000) continue;
        }

        // Filter: max 250 000 km
        if (km && km > 250000) continue;

        // Location
        const locEl = el.querySelector('[class*="location"], [class*="lokacija"], [class*="city"], [class*="grad"]');
        const location = locEl?.innerText?.trim() || '';

        // Transmission
        let transmission = null;
        if (/dsg|automat|tiptronic|cvt|automatski/.test(t)) transmission = 'automatic';
        else if (/manuelni|manuelna|manual/.test(t)) transmission = 'manual';

        // "Nije registrovano" check
        const notRegistered = /nije\s+registr|neregistr/i.test(text);

        // Registration months (from date like "Registracija: 05.2027")
        let regMonths = 0;
        if (!notRegistered) {
          const regMatch = text.match(/registr[a-z]*[:\s]+(\d{2})\.(\d{4})/i);
          if (regMatch) {
            const now = new Date();
            regMonths = Math.max(0, (parseInt(regMatch[2]) - now.getFullYear()) * 12 + (parseInt(regMatch[1]) - now.getMonth() - 1));
          }
        }

        // Registration cost in RSD
        let annualRegCostEur = null;
        const rsdMatch = text.match(/od\s+([\d\.,]+)\s*rsd\s+do\s+([\d\.,]+)\s*rsd/i);
        if (rsdMatch) {
          const min = parseInt(rsdMatch[1].replace(/[^\d]/g, ''));
          const max = parseInt(rsdMatch[2].replace(/[^\d]/g, ''));
          annualRegCostEur = Math.round((min + max) / 2 / 117);
        }

        const monthlyRate = annualRegCostEur ? annualRegCostEur / 12 : 40;

        // regBonus: positive = registration included (saves money)
        //           negative = not registered (buyer must pay ~12 months)
        const regBonus = notRegistered
          ? -Math.round(12 * monthlyRate)
          : Math.round(regMonths * monthlyRate);

        const id = `${brand}-${model}-${price}-${km || 0}-${year || 0}`;
        listings.push({ id, title, price, year, km, engine, engineCC, location, link: href, image, fuel, transmission, regMonths, notRegistered, annualRegCostEur, regBonus, searchLabel: label });
      }

      return listings;
    }, { brand: search.brand, model: search.model, label: search.label, keywords: search.keywords || [], MIN_PRICE, MAX_PRICE, MIN_YEAR });

    console.log(`  [${url.includes('poslednja24h') ? '24h' : 'baseline'}] Found ${results.length} listings`);
    return results;
  } catch (err) {
    console.error(`  Fetch error for ${url}: ${err.message}`);
    return [];
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
    const annualRegCostEur = parseRegistrationCostEur(fullText);
    const regBonus = calcRegBonus(regMonths, annualRegCostEur);

    const id = `${search.brand}-${search.model}-${price}-${km || 0}-${year || 0}`;
    listings.push({ id, title, price, year, km, engine, location, link: fullLink, image, fuel, transmission, regMonths, annualRegCostEur, regBonus, searchLabel: search.label });
  });

  return listings;
}

async function fetchListings(search, last24h = false) {
  const url = last24h
    ? `https://www.polovniautomobili.com/auto-oglasi/poslednja24h?brand=${search.brand}&model=${search.model}&price_from=${MIN_PRICE}&price_to=${MAX_PRICE}&year_from=${MIN_YEAR}&year_to=&modeltxt=&showOldNew=all&country=&city=&submit_1=&page=&sort=`
    : `https://www.polovniautomobili.com/auto-oglasi/pretraga?brand=${search.brand}&model=${search.model}&price_from=${MIN_PRICE}&price_to=${MAX_PRICE}&year_from=${MIN_YEAR}&sort=date_desc&showOldNew=all&page=1`;
  return fetchListingsFromPage(url, search);
}

async function fetchBaseline(search) {
  const results = [];
  let page = 1;
  let thinStreak = 0; // consecutive pages with ≤2 listings
  while (true) {
    const url = `https://www.polovniautomobili.com/auto-oglasi/pretraga?brand=${search.brand}&model=${search.model}&price_from=${MIN_PRICE}&price_to=${MAX_PRICE}&year_from=${MIN_YEAR}&sort=date_desc&showOldNew=all&page=${page}`;
    const listings = await fetchListingsFromPage(url, search);
    if (listings.length === 0) break;
    results.push(...listings);
    thinStreak = listings.length <= 2 ? thinStreak + 1 : 0;
    if (thinStreak >= 10) break; // 10 consecutive near-empty pages → stop
    page++;
    await new Promise((r) => setTimeout(r, 500));
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
  const regCostNote = listing.annualRegCostEur ? `≈${listing.annualRegCostEur}€/god` : `≈${REG_VALUE_PER_MONTH_FALLBACK}€/mes`;
  const regNote = listing.notRegistered
    ? ` ⚠️ nije registrovano (trošak ≈${Math.abs(regBonus)}€)`
    : regBonus > 0 ? ` + ${listing.regMonths} mes. reg. (${regCostNote}, bonus ≈${regBonus}€)` : '';

  const reason =
    `Efektivna cena ${effectivePrice.toLocaleString('de-DE')}€${regNote} je ${Math.abs(Math.round(deviationPct * 100))}% ` +
    `${direction} medijana (${median.toLocaleString('de-DE')}€) ` +
    `na osnovu ${poolDesc}${extras ? ` [${extras}]` : ''}.`;

  return { dealScore, marketAvg: median, savings: Math.round(savings), reason };
}

function buildEmailHtml(deals) {
  const fuelLabel = { diesel: '⛽ Dizel', petrol: '⛽ Benzin', hybrid: '🔋 Hibrid', electric: '⚡ Struja' };
  const transLabel = { automatic: '🔄 Automat', manual: '⚙️ Manuelni' };

  const cards = deals
    .sort((a, b) => b.dealScore - a.dealScore)
    .map((d) => {
      const scoreColor = d.dealScore >= 95 ? '#00c853' : d.dealScore >= 85 ? '#ff9100' : '#f44336';
      const tags = [
        d.fuel ? `<span style="background:#f0f0f0;border-radius:4px;padding:2px 6px;font-size:12px;">${fuelLabel[d.fuel] || d.fuel}</span>` : '',
        d.transmission ? `<span style="background:#f0f0f0;border-radius:4px;padding:2px 6px;font-size:12px;">${transLabel[d.transmission] || d.transmission}</span>` : '',
        d.notRegistered ? `<span style="background:#fff3e0;color:#e65100;border-radius:4px;padding:2px 6px;font-size:12px;">⚠️ Nije registrovano</span>` : d.regMonths > 0 ? `<span style="background:#e8f5e9;color:#2e7d32;border-radius:4px;padding:2px 6px;font-size:12px;">📋 Reg. još ${d.regMonths} mes.</span>` : '',
      ].filter(Boolean).join(' ');

      return `
<div style="background:white;border-radius:12px;margin-bottom:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
  ${d.image ? `<img src="${d.image}" style="width:100%;height:200px;object-fit:cover;display:block;" />` : ''}
  <div style="padding:16px;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px;">
      <div style="font-size:16px;font-weight:bold;color:#1a1a2e;line-height:1.3;">${d.title}</div>
      <div style="flex-shrink:0;background:${scoreColor};color:white;border-radius:20px;padding:4px 12px;font-weight:bold;font-size:15px;white-space:nowrap;">${d.dealScore}/100</div>
    </div>
    <div style="font-size:13px;color:#666;margin-bottom:8px;">
      ${d.searchLabel} · ${d.year || '?'} · ${d.km ? d.km.toLocaleString('de-DE') + ' km' : '?'} · ${d.engine || '?'}
    </div>
    ${tags ? `<div style="margin-bottom:10px;">${tags}</div>` : ''}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <div>
        <div style="font-size:22px;font-weight:bold;color:#1a1a2e;">${d.price?.toLocaleString('de-DE')} €</div>
        ${d.marketAvg ? `<div style="font-size:12px;color:#999;">Median: ${d.marketAvg.toLocaleString('de-DE')} €</div>` : ''}
      </div>
      ${d.savings > 0 ? `<div style="text-align:right;"><div style="font-size:18px;font-weight:bold;color:#00c853;">▼ ${d.savings.toLocaleString('de-DE')} €</div><div style="font-size:11px;color:#999;">uštedina</div></div>` : ''}
    </div>
    <div style="font-size:12px;color:#555;background:#f8f8f8;border-radius:6px;padding:10px;margin-bottom:12px;line-height:1.5;">${d.reason}</div>
    ${d.link ? `<a href="${d.link}" style="display:block;text-align:center;background:#0066cc;color:white;text-decoration:none;border-radius:8px;padding:12px;font-weight:bold;font-size:15px;">Pogledaj oglas →</a>` : ''}
  </div>
</div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:16px;">
    <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:12px;padding:24px;margin-bottom:16px;">
      <h1 style="margin:0 0 6px;color:white;font-size:22px;">Nova Top Ponuda! 🚗</h1>
      <p style="margin:0;color:#aaa;font-size:13px;">${deals.length} oglasa · score ≥ ${MIN_DEAL_SCORE} · ${new Date().toLocaleString('sr-RS')}</p>
    </div>
    ${cards}
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
    subject: `${deals.length} top ponuda na polovniautomobili.rs (Score ${MIN_DEAL_SCORE}+)`,
    html: buildEmailHtml(deals),
  });
  console.log(`Email sent to ${NOTIFY_EMAIL} with ${deals.length} deals`);
}

// Run fn over items with at most `concurrency` in-flight at once
async function pMap(items, fn, concurrency = 5) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function main() {
  console.log(`\n=== Auto Monitor Start: ${new Date().toISOString()} ===`);
  console.log(`Min price: ${MIN_PRICE}€ | Min deal score: ${MIN_DEAL_SCORE} | Searches: ${SEARCHES.length}`);

  await initBrowser();

  const seen = loadSeen();
  const newDeals = [];

  // Phase 1: fetch all pages for all 30 models in parallel (5 concurrent)
  console.log('\n--- Phase 1: Fetching baseline listings for all models (parallel) ---');
  const baselineResults = await pMap(SEARCHES, async (search) => {
    const listings = await fetchBaseline(search);
    console.log(`  ${search.label}: ${listings.length} baseline listings`);
    return listings;
  }, 2);
  const globalBaseline = baselineResults.flat();
  console.log(`Global baseline pool: ${globalBaseline.length} listings across all models`);

  // Phase 2: fetch 24h listings for all models in parallel (5 concurrent)
  console.log('\n--- Phase 2: Checking new listings (parallel) ---');
  const phase2Results = await pMap(SEARCHES, async (search) => {
    const rawListings = await fetchListings(search, true);

    // Deduplicate by ID — keep the entry with an image when there are duplicates
    const dedupMap = new Map();
    for (const l of rawListings) {
      const existing = dedupMap.get(l.id);
      if (!existing || (!existing.image && l.image)) {
        dedupMap.set(l.id, l);
      }
    }
    const newListings = Array.from(dedupMap.values());
    console.log(`  ${search.label}: ${newListings.length} novi (raw: ${rawListings.length})`);
    return newListings;
  }, 2);

  for (const newListings of phase2Results) {
    if (newListings.length === 0) continue;

    const scoringPool = [...newListings, ...globalBaseline];

    const toScore = newListings.filter((l) => {
      const prev = seen[l.id];
      if (!prev) return true;
      return prev.price !== l.price;
    });

    for (const listing of toScore) {
      const scored = scoreListing(listing, scoringPool);
      console.log(`    ${listing.title}: score=${scored.dealScore}, cena=${listing.price}€, median=${scored.marketAvg}€`);
      if (scored.dealScore >= MIN_DEAL_SCORE) {
        newDeals.push({ ...listing, ...scored });
      }
    }

    for (const l of newListings) {
      seen[l.id] = { date: new Date().toISOString(), price: l.price };
    }
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
