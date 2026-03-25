/**
 * scrape-dm.js
 * Scraper za tz-donjimiholjac.hr i donji-miholjac.hr
 * Output: api/_scraped_content.js
 *
 * Što se skrapa:
 *   - Vijesti s Grada Donji Miholjac (RSS ili HTML)
 *   - Manifestacije s TZ (HTML)
 *   - Smještaj s TZ (HTML)
 *   - Restorani i gastronomija (HTML)
 *   - Atrakcije i znamenitosti (HTML)
 */

import { writeFileSync } from 'fs';

const HEADERS = {
  'User-Agent': 'DonjiMiholjacChatbotScraper/1.0 (tourist-info-bot)',
  'Accept-Language': 'hr,en;q=0.8',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

async function fetchHtml(url) {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    console.warn(`⚠️  Nije moguće dohvatiti ${url}: ${e.message}`);
    return null;
  }
}

function stripHtml(html) {
  return (html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ─── Vijesti s Grada Donji Miholjac ──────────────────────────────────────────

async function scrapeVijesti() {
  console.log('🔍 Scraping vijesti iz Donjeg Miholjca...');
  const items = [];

  // Pokušaj RSS feed
  const rssUrl = 'https://www.donji-miholjac.hr/vijesti?format=feed&type=rss';
  const xml = await fetchHtml(rssUrl);
  if (xml && xml.includes('<item>')) {
    const entries = xml.split('<item>').slice(1);
    for (const entry of entries.slice(0, 10)) {
      const titleRaw = (
        entry.match(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/) ||
        entry.match(/<title>([^<]+)<\/title>/)
      )?.[1]?.trim() || '';
      const link = entry.match(/<link>([^<]+)<\/link>/)?.[1]?.trim() || '';
      const dateRaw = entry.match(/<pubDate>([^<]+)<\/pubDate>/)?.[1]?.trim() || '';

      if (!titleRaw) continue;

      // Formatiraj datum
      let datum = '';
      if (dateRaw) {
        try {
          const d = new Date(dateRaw);
          datum = `${d.getDate()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${d.getFullYear()}.`;
        } catch { datum = dateRaw; }
      }

      items.push({ naslov: titleRaw, datum, link });
    }
    console.log(`  ✅ Vijesti (RSS): ${items.length} stavki`);
    return items;
  }

  // Fallback: HTML stranica vijesti
  const html = await fetchHtml('https://www.donji-miholjac.hr/vijesti');
  if (!html) return items;

  // Jednostavni parser za Joomla HTML vijesti
  const articleRegex = /<h[2-4][^>]*class="[^"]*article[^"]*"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
  let match;
  while ((match = articleRegex.exec(html)) !== null && items.length < 10) {
    items.push({ naslov: match[2].trim(), datum: '', link: 'https://www.donji-miholjac.hr' + match[1] });
  }

  console.log(`  ✅ Vijesti (HTML fallback): ${items.length} stavki`);
  return items;
}

// ─── Manifestacije s TZ ──────────────────────────────────────────────────────

async function scrapeManifestacije() {
  console.log('🔍 Scraping manifestacije...');
  const items = [];

  const html = await fetchHtml('https://www.tz-donjimiholjac.hr/category/manifestacije/');
  if (!html) return items;

  // Traži WordPress post naslove i opise
  const postRegex = /<h[2-3][^>]*class="[^"]*entry-title[^"]*"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
  let match;
  while ((match = postRegex.exec(html)) !== null && items.length < 15) {
    items.push({
      naziv: stripHtml(match[2]).trim(),
      link: match[1],
      datum: 'Aktualno'
    });
  }

  // Fallback: traži linkove s tekstom
  if (items.length === 0) {
    const linkRegex = /<a[^>]*href="(https:\/\/www\.tz-donjimiholjac\.hr\/[^"]+)"[^>]*>([^<]{10,80})<\/a>/gi;
    while ((match = linkRegex.exec(html)) !== null && items.length < 10) {
      const naziv = stripHtml(match[2]).trim();
      if (naziv && !naziv.includes('→') && !naziv.includes('»')) {
        items.push({ naziv, link: match[1], datum: 'Aktualno' });
      }
    }
  }

  console.log(`  ✅ Manifestacije: ${items.length} stavki`);
  return items;
}

// ─── Smještaj s TZ ───────────────────────────────────────────────────────────

async function scrapeSmjestaj() {
  console.log('🔍 Scraping smještaj...');
  const apartmani = [];

  const html = await fetchHtml('https://www.tz-donjimiholjac.hr/category/smjestaj-i-zabava/');
  if (!html) return apartmani;

  // Traži WordPress post naslove
  const postRegex = /<h[2-3][^>]*class="[^"]*entry-title[^"]*"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
  let match;
  while ((match = postRegex.exec(html)) !== null && apartmani.length < 20) {
    const naziv = stripHtml(match[2]).trim();
    if (naziv && naziv.length > 3) {
      apartmani.push({
        naziv,
        tip: 'Smještaj',
        adresa: 'Donji Miholjac',
        web: match[1]
      });
    }
  }

  console.log(`  ✅ Smještaj: ${apartmani.length} stavki`);
  return apartmani;
}

// ─── Restorani s TZ ──────────────────────────────────────────────────────────

async function scrapeRestorani() {
  console.log('🔍 Scraping restorani...');
  const restorani = [];

  const html = await fetchHtml('https://www.tz-donjimiholjac.hr/category/gastronomija/');
  if (!html) return restorani;

  // Traži WordPress post naslove
  const postRegex = /<h[2-3][^>]*class="[^"]*entry-title[^"]*"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
  let match;
  while ((match = postRegex.exec(html)) !== null && restorani.length < 20) {
    const naziv = stripHtml(match[2]).trim();
    if (naziv && naziv.length > 3) {
      restorani.push({
        naziv,
        tip: 'Gastronomija',
        adresa: 'Donji Miholjac',
        web: match[1]
      });
    }
  }

  console.log(`  ✅ Restorani: ${restorani.length} stavki`);
  return restorani;
}

// ─── Atrakcije i znamenitosti ─────────────────────────────────────────────────

async function scrapeAtrakcije() {
  console.log('🔍 Scraping atrakcije...');
  const atrakcije = [];

  const html = await fetchHtml('https://www.tz-donjimiholjac.hr/category/znamenitosti/');
  if (!html) return atrakcije;

  // Traži WordPress post naslove
  const postRegex = /<h[2-3][^>]*class="[^"]*entry-title[^"]*"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
  let match;
  while ((match = postRegex.exec(html)) !== null && atrakcije.length < 20) {
    const naziv = stripHtml(match[2]).trim();
    if (naziv && naziv.length > 3) {
      atrakcije.push({
        naziv,
        tip: 'Znamenitost',
        adresa: 'Donji Miholjac',
        web: match[1]
      });
    }
  }

  console.log(`  ✅ Atrakcije: ${atrakcije.length} stavki`);
  return atrakcije;
}

// ─── O gradu ─────────────────────────────────────────────────────────────────

async function scrapeOGradu() {
  console.log('🔍 Scraping o gradu...');
  const result = {};

  const html = await fetchHtml('https://www.tz-donjimiholjac.hr/');
  if (!html) return result;

  // Traži meta description kao opis
  const metaDesc = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i)?.[1] || '';
  if (metaDesc) {
    result.grad_opis = stripHtml(metaDesc);
  }

  return result;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Počinje scraping Donji Miholjac...\n');

  const [vijesti, manifestacije, apartmani, restorani, atrakcije, oGradu] = await Promise.all([
    scrapeVijesti(),
    scrapeManifestacije(),
    scrapeSmjestaj(),
    scrapeRestorani(),
    scrapeAtrakcije(),
    scrapeOGradu()
  ]);

  const data = {
    meta: {
      zadnje_azuriranje: new Date().toISOString(),
      izvori: [
        'https://www.tz-donjimiholjac.hr/',
        'https://www.tz-donjimiholjac.hr/category/manifestacije/',
        'https://www.tz-donjimiholjac.hr/category/smjestaj-i-zabava/',
        'https://www.tz-donjimiholjac.hr/category/gastronomija/',
        'https://www.tz-donjimiholjac.hr/category/znamenitosti/',
        'https://www.donji-miholjac.hr/vijesti'
      ]
    },
    o_nama: oGradu,
    smjestaj_hoteli: [],
    smjestaj_apartmani: apartmani,
    restorani_tz: restorani,
    atrakcije_tz: atrakcije,
    kulturna_bastina: atrakcije,
    manifestacije_aktualne: manifestacije,
    novosti_grad: vijesti,
    poi: {}
  };

  console.log('\n📊 Rezultati:');
  console.log(`  Vijesti: ${vijesti.length}`);
  console.log(`  Manifestacije: ${manifestacije.length}`);
  console.log(`  Smještaj: ${apartmani.length}`);
  console.log(`  Restorani: ${restorani.length}`);
  console.log(`  Atrakcije: ${atrakcije.length}`);

  const code = `// Automatski generira: npm run scrape\n// Zadnje skrapanje: ${new Date().toISOString().slice(0,16).replace('T',' ')} UTC\n// Izvor: tz-donjimiholjac.hr, donji-miholjac.hr\nexport const scrapedContent = ${JSON.stringify(data, null, 2)};\n`;

  writeFileSync('api/_scraped_content.js', code, 'utf8');
  console.log('\n✅ Scraped content saved to api/_scraped_content.js');
}

main().catch(console.error);
