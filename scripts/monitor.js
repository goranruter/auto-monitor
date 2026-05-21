const { chromium } = require('playwright');
const cheerio = require('cheerio');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const MIN_DEAL_SCORE = parseInt(process.env.MIN_DEAL_SCORE || '80');
const MIN_PRICE = parseInt(process.env.MIN_PRICE || '3000');
const MAX_PRICE = parseInt(process.env.MAX_PRICE || '20000');
const MIN_YEAR = parseInt(process.env.MIN_YEAR || '2014');

// MONITOR_TYPE: 'suv' (default) or 'cars'
const MONITOR_TYPE = (process.env.MONITOR_TYPE || 'suv').toLowerCase();
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'goranruter1@gmail.com';
const SEEN_FILE = path.join(__dirname, '../seen.json');
const BASELINE_CACHE_FILE = path.join(__dirname, '../baseline_cache.json');
const BASELINE_CACHE_HOURS = parseInt(process.env.BASELINE_CACHE_HOURS || '8');
const RESULTS_FILE = path.join(__dirname, '../last_results.json');

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

const SEARCHES = [...SEARCHES_SUV, ...SEARCHES_CARS];

// If MONITOR_MODELS env is set (comma-separated "brand-model" keys), run only those models.
// Models not in the predefined SEARCHES list get a generic entry (URL-based filtering is enough).
const MONITOR_MODELS_ENV = process.env.MONITOR_MODELS;

// Multi-word brand names that contain hyphens — needed to split key → brand + model correctly
const HYPHEN_BRANDS = ['mercedes-benz', 'land-rover', 'alfa-romeo', 'aston-martin'];

function buildSearchFromKey(key) {
  // Prefer predefined entry (has keywords, labels etc.)
  const existing = SEARCHES.find(s => `${s.brand}-${s.model}` === key);
  if (existing) return existing;
  // Build generic entry for any other brand/model
  let brand, model;
  const hb = HYPHEN_BRANDS.find(b => key.startsWith(b + '-'));
  if (hb) {
    brand = hb;
    model = key.slice(hb.length + 1);
  } else {
    const i = key.indexOf('-');
    brand = key.slice(0, i);
    model = key.slice(i + 1);
  }
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const label = brand.split('-').map(cap).join(' ') + ' ' + model.split('-').map(cap).join(' ');
  return { brand, model, label, keywords: [] };
}

const ACTIVE_SEARCHES = MONITOR_MODELS_ENV
  ? MONITOR_MODELS_ENV.split(',').filter(Boolean).map(buildSearchFromKey)
  : SEARCHES;

// Generation ranges per model — used to ensure fair price comparison within same generation
const GENERATIONS = {
  'volkswagen-golf':        [{from:2013,to:2019,gen:'7'},{from:2020,to:9999,gen:'8'}],
  'volkswagen-passat':      [{from:2015,to:9999,gen:'B8'},{from:2011,to:2014,gen:'B7'}],
  'volkswagen-tiguan':      [{from:2016,to:9999,gen:'2'},{from:2007,to:2015,gen:'1'}],
  'volkswagen-touareg':     [{from:2018,to:9999,gen:'3'},{from:2010,to:2017,gen:'2'}],
  'skoda-octavia':          [{from:2020,to:9999,gen:'4'},{from:2013,to:2019,gen:'3'}],
  'skoda-superb':           [{from:2015,to:9999,gen:'3'}],
  'skoda-kodiaq':           [{from:2017,to:9999,gen:'1'}],
  'seat-leon':              [{from:2020,to:9999,gen:'4'},{from:2013,to:2019,gen:'3'}],
  'audi-a4':                [{from:2016,to:9999,gen:'B9'},{from:2008,to:2015,gen:'B8'}],
  'audi-a6':                [{from:2018,to:9999,gen:'C8'},{from:2011,to:2017,gen:'C7'}],
  'audi-q3':                [{from:2019,to:9999,gen:'2'},{from:2011,to:2018,gen:'1'}],
  'audi-q5':                [{from:2017,to:9999,gen:'2'},{from:2008,to:2016,gen:'1'}],
  'bmw-serija-3':           [{from:2019,to:9999,gen:'G20'},{from:2012,to:2018,gen:'F30'}],
  'bmw-serija-5':           [{from:2017,to:9999,gen:'G30'},{from:2010,to:2016,gen:'F10'}],
  'bmw-x1':                 [{from:2015,to:2021,gen:'F48'},{from:2022,to:9999,gen:'U11'}],
  'bmw-x3':                 [{from:2018,to:9999,gen:'G01'},{from:2011,to:2017,gen:'F25'}],
  'mercedes-benz-c-klasa':  [{from:2014,to:9999,gen:'W205'},{from:2007,to:2013,gen:'W204'}],
  'mercedes-benz-e-klasa':  [{from:2016,to:9999,gen:'W213'},{from:2009,to:2015,gen:'W212'}],
  'mercedes-benz-glc':      [{from:2016,to:2022,gen:'X253'},{from:2022,to:9999,gen:'X254'}],
  'opel-astra':             [{from:2016,to:2021,gen:'K'},{from:2010,to:2015,gen:'J'},{from:2022,to:9999,gen:'L'}],
  'opel-insignia':          [{from:2017,to:9999,gen:'B'},{from:2009,to:2016,gen:'A'}],
  'ford-focus':             [{from:2018,to:9999,gen:'4'},{from:2011,to:2017,gen:'3'}],
  'ford-mondeo':            [{from:2015,to:9999,gen:'5'}],
  'ford-kuga':              [{from:2020,to:9999,gen:'3'},{from:2013,to:2019,gen:'2'}],
  'renault-megane':         [{from:2016,to:9999,gen:'4'},{from:2008,to:2015,gen:'3'}],
  'renault-kadjar':         [{from:2015,to:2022,gen:'1'}],
  'peugeot-308':            [{from:2021,to:9999,gen:'3'},{from:2013,to:2020,gen:'2'}],
  'peugeot-3008':           [{from:2016,to:9999,gen:'2'},{from:2009,to:2015,gen:'1'}],
  'toyota-auris':           [{from:2013,to:2018,gen:'2'}],
  'toyota-rav4':            [{from:2019,to:9999,gen:'5'},{from:2013,to:2018,gen:'4'}],
  'hyundai-i30':            [{from:2017,to:9999,gen:'3'},{from:2012,to:2016,gen:'2'}],
  'hyundai-tucson':         [{from:2021,to:9999,gen:'4'},{from:2015,to:2020,gen:'3'}],
  'hyundai-ix35':           [{from:2009,to:2015,gen:'1'}],
  'kia-ceed':               [{from:2018,to:9999,gen:'3'},{from:2012,to:2017,gen:'2'}],
  'kia-sportage':           [{from:2022,to:9999,gen:'5'},{from:2016,to:2021,gen:'4'}],
  'nissan-qashqai':         [{from:2021,to:9999,gen:'3'},{from:2014,to:2020,gen:'2'}],
  'mazda-cx-5':             [{from:2017,to:9999,gen:'2'},{from:2012,to:2016,gen:'1'}],
  'jeep-compass':           [{from:2017,to:9999,gen:'2'}],
  'mitsubishi-outlander':   [{from:2021,to:9999,gen:'4'},{from:2012,to:2020,gen:'3'}],
  'honda-cr-v':             [{from:2017,to:9999,gen:'5'},{from:2012,to:2016,gen:'4'}],
};

function getGeneration(brand, model, year) {
  if (!year) return null;
  const gens = GENERATIONS[`${brand}-${model}`];
  if (!gens) return null;
  const found = gens.find(g => year >= g.from && year <= g.to);
  return found ? found.gen : null;
}

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

function loadBaselineCache() {
  try {
    const data = JSON.parse(fs.readFileSync(BASELINE_CACHE_FILE, 'utf8'));
    const ageHours = (Date.now() - new Date(data.timestamp).getTime()) / 3600000;
    if (ageHours < BASELINE_CACHE_HOURS) {
      console.log(`  Using cached baseline (${ageHours.toFixed(1)}h old, refresh after ${BASELINE_CACHE_HOURS}h)`);
      return data.models;
    }
  } catch {}
  return null;
}

function saveBaselineCache(models) {
  fs.writeFileSync(BASELINE_CACHE_FILE, JSON.stringify({ timestamp: new Date().toISOString(), models }, null, 2));
}

function saveResults(results) {
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
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

    // Debug: print page title and link count to diagnose blocks/structure changes
    const pageTitle = await page.title();
    const adLinkCount = await page.evaluate(() =>
      document.querySelectorAll('a[href*="/auto-oglasi/"]').length
    );
    if (adLinkCount === 0) {
      console.log(`  [DEBUG] title="${pageTitle}" | ad-links=0 | url=${url.slice(0, 80)}`);
    }

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

        // Strip injected promotional boilerplate before parsing data
        const rawText = el.innerText || '';
        const text = rawText.replace(/automatska klima[\s\S]*?kožna sedi[šs]ta/gi, '').trim();

        // Title: first line only (avoids bleed-in of promo text)
        const heading = el.querySelector('h2, h3, h4, [class*="title"], [class*="naziv"]');
        const rawTitle = heading?.innerText?.trim() || link.innerText?.trim() || '';
        const title = rawTitle.split('\n')[0].trim();
        if (!title || title.length < 3) continue;

        // Keyword filter — ensure listing actually matches the intended model
        if (keywords && keywords.length > 0) {
          const titleLower = title.toLowerCase();
          if (!keywords.some(kw => titleLower.includes(kw.toLowerCase()))) continue;
        }

        // Link — prefer a direct listing URL with numeric ID (/auto-oglasi/12345/slug)
        const allLinks = Array.from(el.querySelectorAll('a[href*="/auto-oglasi/"]'));
        const directLink = allLinks.find(a => /\/auto-oglasi\/\d+\//.test(a.href)) || link;
        const href = directLink.href || '';

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

        // Equipment detection
        const has4x4       = /\b4x4\b|4wd|awd|quattro|xdrive|4motion|syncro|all.?wheel/i.test(text);
        const hasPanorama  = /panoram|panoramski|sunroof|stakleni krov/i.test(text);
        const hasLeather   = /kožna|koža\b|leather|leder/i.test(text);
        const hasNavigation= /navigaci|navi\b|gps navigaci/i.test(text);
        const hasHeatedSeats=/grejana sedišta|grejana sedista|heated seat/i.test(text);

        // Condition signals
        const hasAccident     = /havarisan|havarisano|udaren|oštećen(?!a reg)/i.test(text);
        const isFirstOwner    = /prvi vlasnik|1\.\s*vlasnik|1 vlasnik/i.test(text);
        const hasServiceHistory=/redovno servisan|servisna knjiga|kompletan servis/i.test(text);

        const id = `${brand}-${model}-${price}-${km || 0}-${year || 0}`;
        listings.push({ id, title, price, year, km, engine, engineCC, location, link: href, image, fuel, transmission, regMonths, notRegistered, annualRegCostEur, regBonus, searchLabel: label, brand, model, has4x4, hasPanorama, hasLeather, hasNavigation, hasHeatedSeats, hasAccident, isFirstOwner, hasServiceHistory });
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
  const generation = getGeneration(listing.brand, listing.model, year);
  const others = allListings.filter((l) => l.id !== listing.id && l.price >= MIN_PRICE);

  const genOk  = (l) => {
    if (!generation) return true;
    const lg = getGeneration(l.brand, l.model, l.year);
    return !lg || lg === generation;
  };
  const yearOk = (l) => !year || !l.year || Math.abs(l.year - year) <= 2;
  const kmOk   = (l) => !km || !l.km || (l.km >= km * 0.6 && l.km <= km * 1.4);
  const fuelOk = (l) => !fuel || !l.fuel || l.fuel === fuel;
  const transOk= (l) => !transmission || !l.transmission || l.transmission === transmission;

  // 1. Best: same generation, km ±40%, same fuel, same transmission
  let pool = others.filter((l) => genOk(l) && kmOk(l) && fuelOk(l) && transOk(l));
  let poolDesc = `${pool.length} oglasa (gen${generation ? ' '+generation : ''}, km, gorivo, menjač)`;

  // 2. Drop transmission
  if (pool.length < 4) {
    pool = others.filter((l) => genOk(l) && kmOk(l) && fuelOk(l));
    poolDesc = `${pool.length} oglasa (gen${generation ? ' '+generation : ''}, km, gorivo)`;
  }

  // 3. Drop fuel
  if (pool.length < 4) {
    pool = others.filter((l) => genOk(l) && kmOk(l));
    poolDesc = `${pool.length} oglasa (gen${generation ? ' '+generation : ''}, slična km)`;
  }

  // 4. Same generation only (drop km)
  if (pool.length < 4) {
    pool = others.filter((l) => genOk(l));
    poolDesc = `${pool.length} oglasa (gen${generation ? ' '+generation : ''})`;
  }

  // 5. Year ±2 fallback (ignore generation)
  if (pool.length < 4) {
    pool = others.filter((l) => yearOk(l) && kmOk(l));
    poolDesc = `${pool.length} oglasa (god ±2, slična km)`;
  }

  // 6. Year ±3
  if (pool.length < 4) {
    pool = others.filter((l) => !year || !l.year || Math.abs(l.year - year) <= 3);
    poolDesc = `${pool.length} oglasa (god ±3)`;
  }

  // 7. All
  if (pool.length < 3) {
    pool = others;
    poolDesc = `${pool.length} oglasa modela`;
  }

  if (pool.length === 0) {
    return { dealScore: 50, priceRating: 'N/A', marketAvg: null, savings: 0, reason: 'Nedovoljno podataka.' };
  }

  // --- Mileage-normalized median (mobile.de approach) ---
  // Estimate depreciation per km from pool: fit linear regression price ~ km
  // then shift each pool car's price to the target km before computing median
  let normalizedPrices = pool.map(l => l.price); // fallback: raw prices
  if (km > 0 && pool.filter(l => l.km > 0).length >= 4) {
    const pts = pool.filter(l => l.km > 0 && l.price > 0);
    const n = pts.length;
    const sumX = pts.reduce((s, l) => s + l.km, 0);
    const sumY = pts.reduce((s, l) => s + l.price, 0);
    const sumXY = pts.reduce((s, l) => s + l.km * l.price, 0);
    const sumX2 = pts.reduce((s, l) => s + l.km * l.km, 0);
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX); // €/km (negative = depreciation)
    if (slope < 0) {
      // Shift each car's price to what it would cost at the target mileage
      normalizedPrices = pool.map(l => {
        if (!l.km) return l.price;
        return Math.round(l.price + slope * (km - l.km)); // adjust to target km
      }).filter(p => p > 0);
    }
  }

  const median = calcMedian(normalizedPrices.length >= 3 ? normalizedPrices : pool.map(l => l.price));

  // Effective price = listed price adjusted for reg, equipment value, and damage
  const regBonus = listing.regBonus || 0;
  const equipmentBonus =
    (listing.has4x4        ? 500 : 0) +
    (listing.hasPanorama   ? 300 : 0) +
    (listing.hasLeather    ? 200 : 0) +
    (listing.hasNavigation ? 150 : 0) +
    (listing.hasHeatedSeats? 100 : 0) +
    (listing.isFirstOwner  ? 300 : 0) +
    (listing.hasServiceHistory ? 150 : 0);
  const damagePenalty = listing.hasAccident ? 2000 : 0;
  const effectivePrice = listing.price - regBonus - equipmentBonus + damagePenalty;
  const savings = median - effectivePrice;
  const deviationPct = savings / median;

  // 5-tier price rating (mobile.de style)
  let priceRating;
  if (deviationPct >= 0.20)       priceRating = '🟢 Odlična cena';
  else if (deviationPct >= 0.10)  priceRating = '🟡 Dobra cena';
  else if (deviationPct >= -0.10) priceRating = '⚪ Fer cena';
  else if (deviationPct >= -0.20) priceRating = '🔴 Visoka cena';
  else                             priceRating = '🔴 Previsoka cena';

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

  return { dealScore, priceRating, marketAvg: median, savings: Math.round(savings), reason };
}

function buildEmailHtml(deals) {
  const fuelLabel = { diesel: '⛽ Dizel', petrol: '⛽ Benzin', hybrid: '🔋 Hibrid', electric: '⚡ Struja' };
  const transLabel = { automatic: '🔄 Automat', manual: '⚙️ Manuelni' };

  const cards = deals
    .sort((a, b) => b.dealScore - a.dealScore)
    .map((d) => {
      const scoreColor = d.dealScore >= 95 ? '#00c853' : d.dealScore >= 85 ? '#ff9100' : '#f44336';
      const ratingBg = d.priceRating?.startsWith('🟢') ? '#e8f5e9' : d.priceRating?.startsWith('🟡') ? '#fffde7' : d.priceRating?.startsWith('⚪') ? '#f5f5f5' : '#fce4ec';
      const ratingColor = d.priceRating?.startsWith('🟢') ? '#2e7d32' : d.priceRating?.startsWith('🟡') ? '#f57f17' : d.priceRating?.startsWith('⚪') ? '#555' : '#c62828';
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
    ${d.priceRating ? `<div style="display:inline-block;background:${ratingBg};color:${ratingColor};border-radius:6px;padding:4px 10px;font-size:13px;font-weight:bold;margin-bottom:8px;">${d.priceRating}</div>` : ''}
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
  console.log(`Min price: ${MIN_PRICE}€ | Max price: ${MAX_PRICE}€ | Min year: ${MIN_YEAR} | Min deal score: ${MIN_DEAL_SCORE} | Searches: ${ACTIVE_SEARCHES.length}`);

  await initBrowser();

  const seen = loadSeen();
  const newDeals = [];

  // Phase 1: baseline — use cache if fresh, otherwise re-fetch
  console.log('\n--- Phase 1: Fetching baseline listings per model ---');
  let baselineByModel = loadBaselineCache();
  let totalBaseline = 0;
  if (!baselineByModel) {
    const baselineResults = await pMap(ACTIVE_SEARCHES, async (search) => {
      const listings = await fetchBaseline(search);
      console.log(`  ${search.label}: ${listings.length} baseline listings`);
      return { key: `${search.brand}-${search.model}`, listings };
    }, 2);
    baselineByModel = {};
    for (const { key, listings } of baselineResults) {
      baselineByModel[key] = listings;
    }
    saveBaselineCache(baselineByModel);
  }
  totalBaseline = Object.values(baselineByModel).reduce((s, l) => s + l.length, 0);
  console.log(`Baseline pool: ${totalBaseline} listings across ${ACTIVE_SEARCHES.length} models`);

  // Phase 2: fetch 24h listings per model, score against that model's own baseline
  console.log('\n--- Phase 2: Checking new listings (parallel) ---');
  const phase2Results = await pMap(ACTIVE_SEARCHES, async (search) => {
    let rawListings = await fetchListings(search, true);
    // Retry once on empty result
    if (rawListings.length === 0) {
      await new Promise(r => setTimeout(r, 3000));
      rawListings = await fetchListings(search, true);
      if (rawListings.length > 0) console.log(`  Retry succeeded for ${search.label}`);
    }

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
    return { search, newListings };
  }, 2);

  for (const { search, newListings } of phase2Results) {
    if (newListings.length === 0) continue;

    // Score against this model's own baseline only
    const modelKey = `${search.brand}-${search.model}`;
    const modelBaseline = baselineByModel[modelKey] || [];
    const scoringPool = [...newListings, ...modelBaseline];

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

  // Save results for GUI
  saveResults({
    timestamp: new Date().toISOString(),
    deals: newDeals,
    modelsChecked: SEARCHES.length,
    totalBaselineListings: totalBaseline,
    minScore: MIN_DEAL_SCORE,
    priceRange: { min: MIN_PRICE, max: MAX_PRICE },
  });

  if (newDeals.length > 0) {
    await sendEmail(newDeals);
  } else {
    console.log('Nema novih top ponuda, email se ne šalje.');
  }
  if (browser) await browser.close();
  console.log('=== Done ===\n');
}

// Allow both direct CLI use and require() from server.js
if (require.main === module) {
  main().catch(async (err) => {
    if (browser) await browser.close();
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { main };
