/**
 * scrape-dm.js
 * Scraper za tz-donjimiholjac.hr koristeći WordPress REST API
 * Output: api/_scraped_content.js
 *
 * Kategorije (ID -> naziv):
 *   5   = Događanja (manifestacije)
 *  22   = Festivali
 *  21   = Sajmovi
 *  30   = Apartmani i sobe
 *  28   = Caffe barovi
 *  32   = Restorani
 *  33   = Fast food
 *  34   = Domaći proizvodi
 *  13   = Spomenička baština
 *  14   = Sakralna baština
 *  25   = Sportski tereni i objekti
 *  15   = Izletišta
 *  26   = Sportski ribolov
 */

import { writeFileSync } from 'fs';

const BASE_API = 'https://www.tz-donjimiholjac.hr/wp-json/wp/v2';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'hr,en;q=0.8',
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn(`  Greska dohvacanja ${url}: ${e.message}`);
    return null;
  }
}

function decodeHtmlEntities(str) {
  return (str || '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8230;/g, '...')
    .replace(/&#39;/g, "'")
    .replace(/&hellip;/g, '...')
    .replace(/&ndash;/g, '-')
    .replace(/&mdash;/g, '-')
    .replace(/&#[0-9]+;/g, '')
    .replace(/&[a-z]+;/g, ' ')
    .trim();
}

function stripHtmlTags(html) {
  return (html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function cleanText(html) {
  return decodeHtmlEntities(stripHtmlTags(html));
}

/**
 * Dohvati sve postove iz kategorije via WordPress REST API.
 */
async function fetchCategoryPosts(categoryId, categoryName, perPage = 100) {
  console.log(`  Dohvacam kategoriju: ${categoryName} (ID: ${categoryId})...`);
  const posts = [];
  let page = 1;

  while (true) {
    const url = `${BASE_API}/posts?categories=${categoryId}&per_page=${perPage}&page=${page}&_embed=1&orderby=date&order=desc`;
    const data = await fetchJson(url);

    if (!data || !Array.isArray(data) || data.length === 0) break;

    posts.push(...data);
    if (data.length < perPage) break;
    page++;
    await sleep(300);
  }

  console.log(`    -> ${posts.length} postova`);
  return posts;
}

/**
 * Normalizira post u format {naziv, tip, adresa, telefon, web, slika, opis}
 */
function normalizePost(post, tip = '') {
  const naziv = decodeHtmlEntities(post.title?.rendered || '');
  const link = post.link || '';

  // Excerpt sadrzi kratki opis, adresu, kontakt
  const excerptRaw = cleanText(post.excerpt?.rendered || '');

  // Pokusaj izvuci adresu iz excerpta (format: "Adresa: XXX")
  const adresaMatch = excerptRaw.match(/Adresa[:\s]+(.+?)(?:\s+Kontakt|\s+Tel|\s+Web|\s+E-mail|\s*\+385|\n|$)/i);
  let adresa = adresaMatch ? adresaMatch[1].trim().replace(/\s+/g, ' ') : '';
  // Ocisti trailing interpunkciju
  adresa = adresa.replace(/[,;]+$/, '').trim();

  // Pokusaj izvuci telefon
  const telefonMatch = excerptRaw.match(/(\+385[\s\d\-\/\(\)]+|\+385[\d\s]+)/);
  const telefon = telefonMatch ? telefonMatch[1].trim() : '';

  // Featured image
  const mediaArr = post._embedded?.['wp:featuredmedia'];
  const slika = (mediaArr && mediaArr[0]?.source_url) ? mediaArr[0].source_url : '';

  // Opis: ukloni adresu i kontakt info, ostavi ostatak
  let opis = excerptRaw
    .replace(/Adresa[:\s]+[^\n]*/gi, '')
    .replace(/Kontakt[:\s]+[^\n]*/gi, '')
    .replace(/E-mail[:\s]+[^\n]*/gi, '')
    .replace(/\+385[\s\d\-\/\(\)]+/g, '')
    .replace(/Saznaj vi.*$/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return { naziv, tip, opis, adresa, telefon, web: link, slika };
}

// --- SCRAPERS PO SEKCIJI ---

async function scrapeManifestacije() {
  console.log('\nScraping manifestacije...');
  const items = [];

  const [dogadjanja, festivali, sajmovi] = await Promise.all([
    fetchCategoryPosts(5, 'Dogadjanja'),
    fetchCategoryPosts(22, 'Festivali'),
    fetchCategoryPosts(21, 'Sajmovi'),
  ]);

  const allManif = [...dogadjanja, ...festivali, ...sajmovi];
  for (const post of allManif) {
    const naziv = decodeHtmlEntities(post.title?.rendered || '');
    const link = post.link || '';
    const dateStr = post.date ? post.date.slice(0, 10) : '';
    const opis = cleanText(post.excerpt?.rendered || '')
      .replace(/Saznaj vi.*/gi, '')
      .trim();

    // Tip iz kategorija
    const terms = post._embedded?.['wp:term'] || [];
    const slugs = terms.flat().map(t => t.slug);
    let tip = 'Dogadjanje';
    if (slugs.includes('festivali')) tip = 'Festival';
    else if (slugs.includes('sajmovi')) tip = 'Sajam';

    items.push({ naziv, tip, opis, datum: dateStr, link });
  }

  return items;
}

async function scrapeSmjestaj() {
  console.log('\nScraping smjestaj...');
  const posts = await fetchCategoryPosts(30, 'Apartmani i sobe');
  return posts.map(p => normalizePost(p, 'Apartman/Sobe'));
}

async function scrapeRestorani() {
  console.log('\nScraping gastronomija (restorani + fast food)...');
  const [restPosts, ffPosts] = await Promise.all([
    fetchCategoryPosts(32, 'Restorani'),
    fetchCategoryPosts(33, 'Fast food'),
  ]);

  return [
    ...restPosts.map(p => normalizePost(p, 'Restoran')),
    ...ffPosts.map(p => normalizePost(p, 'Fast food')),
  ];
}

async function scrapeDomaceProizvode() {
  console.log('\nScraping domaci proizvodi...');
  const posts = await fetchCategoryPosts(34, 'Domaci proizvodi');
  return posts.map(p => normalizePost(p, 'Domaci proizvodi'));
}

async function scrapeCaffeBarove() {
  console.log('\nScraping caffe barovi...');
  const posts = await fetchCategoryPosts(28, 'Caffe barovi');
  return posts.map(p => normalizePost(p, 'Caffe bar'));
}

async function scrapeZnakonitosti() {
  console.log('\nScraping znamenitosti (spomenicka + sakralna bastina)...');
  const [spom, sakr] = await Promise.all([
    fetchCategoryPosts(13, 'Spomenicka bastina'),
    fetchCategoryPosts(14, 'Sakralna bastina'),
  ]);

  return [
    ...spom.map(p => normalizePost(p, 'Spomenicka bastina')),
    ...sakr.map(p => normalizePost(p, 'Sakralna bastina')),
  ];
}

async function scrapeOdmorRekreacija() {
  console.log('\nScraping odmor i rekreacija...');
  const [sportski, izletista, ribolov] = await Promise.all([
    fetchCategoryPosts(25, 'Sportski tereni i objekti'),
    fetchCategoryPosts(15, 'Izletista'),
    fetchCategoryPosts(26, 'Sportski ribolov'),
  ]);

  return [
    ...sportski.map(p => normalizePost(p, 'Sportski teren/objekt')),
    ...izletista.map(p => normalizePost(p, 'Izletiste')),
    ...ribolov.map(p => normalizePost(p, 'Ribolov')),
  ];
}

async function scrapeVijesti() {
  console.log('\nScraping vijesti s TZ...');
  // Koristi dogadjanja kao izvor aktualnih vijesti (najnoviji dogadjaji)
  const posts = await fetchCategoryPosts(5, 'Vijesti/Dogadjanja');
  return posts.slice(0, 20).map(post => ({
    naslov: decodeHtmlEntities(post.title?.rendered || ''),
    datum: post.date ? post.date.slice(0, 10) : '',
    link: post.link || '',
    opis: cleanText(post.excerpt?.rendered || '')
      .replace(/Saznaj vi.*/gi, '')
      .trim(),
  }));
}

async function scrapeOGradu() {
  console.log('\nScraping info o gradu...');
  // Koristi WordPress REST API za stranice 'o-nama' ili 'povijest'
  const slugovi = ['povijest', 'o-gradu', 'o-nama', 'ured-turisticke-zajednice-grada-donji-miholjac'];
  for (const slug of slugovi) {
    const data = await fetchJson(`${BASE_API}/pages?slug=${slug}&_embed=1`);
    if (data && data[0]) {
      const page = data[0];
      // Ukloni Elementor CSS blokove i ocisti tekst
      const rawContent = page.content?.rendered || '';
      const noStyle = rawContent
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '');
      const text = cleanText(noStyle)
        .replace(/\/\*!.*?\*\//g, '')  // ukloni CSS komentare koji ostanu
        .replace(/elementor[^\s]*/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, 800);
      if (text && text.length > 100) {
        return { grad_opis: text };
      }
    }
    await sleep(200);
  }
  return { grad_opis: 'Donji Miholjac je grad u Osjecko-baranjskoj zupaniji, smjesten uz rijeku Dravu na granici s Madjarskom. Poznat po bogatoj kulturnoj bastini — crkvi sv. Mihaela arkandjela, dvorcu Mailath, parku Florijana — rijeci Dravi, sportskim sadrzajima te gastronomiji Slavonije i Baranje.' };
}

// --- MAIN ---

async function main() {
  console.log('Pocinje scraping Donji Miholjac (WP REST API)...\n');

  const manifestacije = await scrapeManifestacije();
  await sleep(400);
  const apartmani = await scrapeSmjestaj();
  await sleep(400);
  const caffebarovi = await scrapeCaffeBarove();
  await sleep(400);
  const restorani = await scrapeRestorani();
  await sleep(400);
  const domaci = await scrapeDomaceProizvode();
  await sleep(400);
  const atrakcije = await scrapeZnakonitosti();
  await sleep(400);
  const odmor = await scrapeOdmorRekreacija();
  await sleep(400);
  const vijesti = await scrapeVijesti();
  await sleep(400);
  const oGradu = await scrapeOGradu();

  // POI mapa
  const poi = {};
  for (const item of [...atrakcije, ...odmor]) {
    if (item.naziv) {
      const key = item.naziv
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
        .slice(0, 50);
      poi[key] = item;
    }
  }

  const data = {
    meta: {
      zadnje_azuriranje: new Date().toISOString(),
      izvori: [
        'https://www.tz-donjimiholjac.hr/wp-json/wp/v2/posts (WordPress REST API)',
      ]
    },
    o_nama: oGradu,
    smjestaj_hoteli: [],
    smjestaj_apartmani: apartmani,
    caffe_barovi: caffebarovi,
    domaci_proizvodi: domaci,
    restorani_tz: restorani,
    atrakcije_tz: [...atrakcije, ...odmor],
    kulturna_bastina: atrakcije,
    odmor_rekreacija: odmor,
    manifestacije_aktualne: manifestacije,
    novosti_grad: vijesti,
    poi,
  };

  console.log('\n=== REZULTATI ===');
  console.log(`  Manifestacije (dogadjanja+festivali+sajmovi): ${manifestacije.length}`);
  console.log(`  Apartmani i sobe: ${apartmani.length}`);
  console.log(`  Caffe barovi: ${caffebarovi.length}`);
  console.log(`  Restorani + fast food: ${restorani.length}`);
  console.log(`  Domaci proizvodi: ${domaci.length}`);
  console.log(`  Kulturna bastina (spom.+sakralna): ${atrakcije.length}`);
  console.log(`  Odmor i rekreacija: ${odmor.length}`);
  console.log(`  Vijesti: ${vijesti.length}`);
  console.log(`  POI ukupno: ${Object.keys(poi).length}`);

  const totalItems = manifestacije.length + apartmani.length + caffebarovi.length +
    restorani.length + domaci.length + atrakcije.length + odmor.length + vijesti.length;
  console.log(`  UKUPNO stavki: ${totalItems}`);
  console.log('=================\n');

  const code = `// Automatski generira: npm run scrape\n// Zadnje skrapanje: ${new Date().toISOString().slice(0,16).replace('T',' ')} UTC\n// Izvor: tz-donjimiholjac.hr WordPress REST API\nexport const scrapedContent = ${JSON.stringify(data, null, 2)};\n`;

  writeFileSync('api/_scraped_content.js', code, 'utf8');
  console.log('Scraped content saved to api/_scraped_content.js');
}

main().catch(console.error);
