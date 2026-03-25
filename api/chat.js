import OpenAI from "openai";
import { db } from "./_database.js";
import { scrapedContent } from "./_scraped_content.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY?.trim()
});

function stripImages(data) {
  if (Array.isArray(data)) return data.map(stripImages);
  if (data && typeof data === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      if (k === 'IMAGE_URL') continue;
      out[k] = stripImages(v);
    }
    return out;
  }
  return data;
}

function getCategoryItems(category) {
  const s = scrapedContent;
  if (!s) return [];

  function item(o, extra) {
    return { naziv: o.naziv || '', slika: o.slika || '', adresa: o.adresa || '',
             telefon: o.telefon || '', web: o.web || '', karta: o.karta || '', ...extra };
  }

  if (category === 'gastronomija') {
    return (s.restorani_tz || []).slice(0, 20).map(r => item(r));
  }
  if (category === 'smjestaj') {
    const hoteli = (s.smjestaj_hoteli || []).map(h => item(h));
    const apartmani = (s.smjestaj_apartmani || [])
      .filter(a => a.slika)
      .slice(0, 20)
      .map(a => item(a));
    return [...hoteli, ...apartmani];
  }
  if (category === 'znamenitosti') {
    return (s.kulturna_bastina || []).map(b => item(b, { opis: b.opis || '' }));
  }
  if (category === 'priroda' || category === 'sport') {
    return (s.atrakcije_tz || []).map(a => item(a, { opis: a.opis || '' }));
  }
  return [];
}

// Vizualne kategorije — uvijek prikazuju minijature
const VISUAL_CATS = ['gastronomija', 'smjestaj', 'znamenitosti', 'priroda', 'sport'];

// Vraća stavke sa slikom za kategoriju — uvijek, bez obzira na kontekst pitanja
function getItemsForCategory(category, limit = 8) {
  const s = scrapedContent;
  if (!s) return [];

  function item(o) {
    return { naziv: o.naziv || '', slika: o.slika || '', adresa: o.adresa || '',
             telefon: o.telefon || '', web: o.web || '', karta: o.karta || '' };
  }

  if (category === 'gastronomija') {
    return (s.restorani_tz || []).filter(o => o.slika).slice(0, limit).map(item);
  }
  if (category === 'smjestaj') {
    const hoteli = (s.smjestaj_hoteli || []).filter(o => o.slika).map(item);
    const apartmani = (s.smjestaj_apartmani || []).filter(o => o.slika).slice(0, limit - hoteli.length).map(item);
    return [...hoteli, ...apartmani].slice(0, limit);
  }
  if (category === 'znamenitosti') {
    return (s.kulturna_bastina || []).filter(o => o.slika).slice(0, limit).map(item);
  }
  if (category === 'priroda' || category === 'sport') {
    return (s.atrakcije_tz || []).filter(o => o.slika).slice(0, limit).map(item);
  }
  return [];
}

// Traži stavke sa slikom koje odgovaraju ključnim riječima u tekstu
function findRelevantItems(text, category) {
  const s = scrapedContent;
  if (!s) return [];
  const t = text.toLowerCase();

  function item(o) {
    return { naziv: o.naziv || '', slika: o.slika || '', adresa: o.adresa || '',
             telefon: o.telefon || '', web: o.web || '', karta: o.karta || '' };
  }

  let pool;
  if (category === 'gastronomija') pool = s.restorani_tz || [];
  else if (category === 'smjestaj') pool = [...(s.smjestaj_hoteli || []), ...(s.smjestaj_apartmani || [])];
  else if (category === 'znamenitosti') pool = s.kulturna_bastina || [];
  else if (category === 'priroda' || category === 'sport') pool = s.atrakcije_tz || [];
  else pool = [...(s.kulturna_bastina || []), ...(s.restorani_tz || []), ...(s.smjestaj_hoteli || [])];

  const matched = pool.filter(o => {
    if (!o.slika) return false;
    const name = (o.naziv || '').toLowerCase();
    const words = name.split(/[\s\-—/]+/).filter(w => w.length > 3);
    return words.some(w => t.includes(w));
  });

  return matched.slice(0, 6).map(item);
}

function buildScrapedSection(category) {
  const s = scrapedContent;
  if (!s) return '';
  const lines = [];
  const ts = s.meta?.zadnje_azuriranje?.substring(0, 10) || '';

  function poiLines(lista, max = 30) {
    return (lista || []).slice(0, max).map(x => {
      const adr = x.adresa ? ` — ${x.adresa}` : '';
      const tel = x.telefon ? ` | ${x.telefon}` : '';
      const rw  = x.radno_vrijeme ? ` | ${x.radno_vrijeme}` : '';
      return `• **${x.naziv}**${adr}${tel}${rw}`;
    });
  }

  if (category === 'opcenito') {
    const o = s.o_nama || {};
    if (o.grad_opis) lines.push(`\nO gradu:\n${o.grad_opis.substring(0, 600)}`);
    if (o.rijec_gradonacelnika) lines.push(`\nRijec gradonacelnika:\n${o.rijec_gradonacelnika.substring(0, 400)}`);
    if (s.novosti_grad?.length) {
      lines.push(`\nNajnovije vijesti (${ts}):`);
      s.novosti_grad.slice(0, 5).forEach(n => lines.push(`• [${n.datum}] ${n.naslov}`));
    }
  }

  if (category === 'smjestaj') {
    if (s.smjestaj_hoteli?.length) {
      lines.push(`\nHoteli, hosteli i pansioni (${s.smjestaj_hoteli.length}):`);
      s.smjestaj_hoteli.forEach(h => {
        const tel = h.telefon ? ` | Tel: ${h.telefon}` : '';
        const web = h.web ? ` | ${h.web}` : '';
        lines.push(`• **${h.naziv}** [${h.tip}] — ${h.adresa}${tel}${web}`);
      });
    }
    if (s.smjestaj_apartmani?.length) {
      lines.push(`\nApartmani, sobe i vile (${s.smjestaj_apartmani.length} ukupno — prvih 30):`);
      s.smjestaj_apartmani.slice(0, 30).forEach(a => {
        const tel = a.telefon ? ` | Tel: ${a.telefon}` : '';
        const web = a.web ? ` | ${a.web}` : '';
        lines.push(`• **${a.naziv}** [${a.tip}] — ${a.adresa}${tel}${web}`);
      });
      if (s.smjestaj_apartmani.length > 30)
        lines.push(`  ... i jos ${s.smjestaj_apartmani.length - 30} objekata: https://www.tz-donjimiholjac.hr`);
    }
  }

  if (category === 'gastronomija') {
    if (s.restorani_tz?.length) {
      lines.push(`\nRestorani registrirani pri TZ (${s.restorani_tz.length}):`);
      s.restorani_tz.forEach(r => {
        const tel = r.telefon ? ` | Tel: ${r.telefon}` : '';
        const web = r.web ? ` | ${r.web}` : '';
        lines.push(`• **${r.naziv}** — ${r.adresa}${tel}${web}`);
      });
    }
    if (s.poi?.caffe_barovi?.length) {
      lines.push(`\nCaffe barovi i kafici (${s.poi.caffe_barovi.length}):`);
      lines.push(...poiLines(s.poi.caffe_barovi, 25));
    }
  }

  if (category === 'dogadanja') {
    if (s.manifestacije_aktualne?.length) {
      lines.push('\nAktualne manifestacije:');
      s.manifestacije_aktualne.forEach(m => {
        lines.push(`• ${m.naziv} (${m.datum})`);
        if (m.opis) lines.push(`  ${m.opis.substring(0, 200)}`);
      });
    }
  }

  if (category === 'znamenitosti') {
    if (s.kulturna_bastina?.length) {
      lines.push(`\nKulturna bastina (${s.kulturna_bastina.length} lokacija):`);
      s.kulturna_bastina.forEach(b => {
        const adr = b.adresa ? ` | ${b.adresa}` : '';
        const tel = b.telefon ? ` | Tel: ${b.telefon}` : '';
        const web = b.web ? ` | ${b.web}` : '';
        lines.push(`• **${b.naziv}** [${b.tip}]${adr}${tel}${web}`);
        if (b.opis) lines.push(`  ${b.opis.substring(0, 250)}`);
      });
    }
  }

  if (category === 'priroda' || category === 'sport') {
    if (s.atrakcije_tz?.length) {
      lines.push(`\nTuristicke atrakcije i rekreacija:`);
      s.atrakcije_tz.forEach(a => {
        const lok = a.lokacija ? ` | ${a.lokacija}` : (a.adresa ? ` | ${a.adresa}` : '');
        lines.push(`• **${a.naziv}** [${a.tip}]${lok}`);
        if (a.opis) lines.push(`  ${a.opis.substring(0, 180)}`);
      });
    }
  }

  if (category === 'okolica') {
    if (s.atrakcije_tz?.length) {
      const prirodne = s.atrakcije_tz.filter(a => a.tip?.includes('Priroda') || a.tip?.includes('Izletiste') || a.lokacija);
      if (prirodne.length) {
        lines.push(`\nIzletista i priroda u okolici:`);
        prirodne.forEach(a => {
          const lok = a.lokacija ? ` | ${a.lokacija}` : '';
          lines.push(`• **${a.naziv}** [${a.tip}]${lok}`);
          if (a.opis) lines.push(`  ${a.opis.substring(0, 150)}`);
        });
      }
    }
  }

  return lines.length ? lines.join('\n') : '';
}

const CATEGORY_CONTEXTS = {
  smjestaj:     (db) => ({ grad: db.grad }),
  gastronomija: (db) => ({ grad: db.grad, lokalna_kuhinja: db.lokalna_kuhinja }),
  dogadanja:    (db) => ({ grad: db.grad, dogadanja: db.dogadanja }),
  znamenitosti: (db) => ({ grad: db.grad, znamenitosti: db.znamenitosti }),
  sport:        (db) => ({ grad: db.grad, sport: db.sport }),
  vinarije:     (db) => ({ grad: db.grad, vinarije: db.vinarije, lokalna_kuhinja: db.lokalna_kuhinja }),
  lov:          (db) => ({ grad: db.grad, lov_ribolov: db.lov_ribolov }),
  opcenito:     (db) => ({ grad: db.grad, opcenito: db.opcenito }),
  priroda:      (db) => ({ grad: db.grad, priroda: db.priroda }),
  okolica:      (db) => ({ grad: db.grad, okolica: db.okolica }),
};

function detectLang(msg) {
  const words = msg.toLowerCase().split(/[\s,?.!;:()\-]+/);
  const has = (list) => list.some(w => words.includes(w));
  if (has(['what','where','how','which','when','is','are','can','do','have','show','find','tell','give','any','some','the','and','but','not','open','map','near','best','visit','see','eat','drink','stay','sleep','book','ticket','price','time','hour']))
    return 'en';
  if (has(['was','wo','wie','welche','wann','ist','sind','kann','haben','zeig','gibt','bitte','ich','ein','eine','der','die','das','und','oder','nicht','hier','mit','für','von','nach','beim','zum','zur']))
    return 'de';
  return 'hr';
}

const TR = {
  hr: {
    map:        'Otvori na karti',
    more:       'Više informacija',
    tzMore:     'Više informacija na TZ Donji Miholjac',
    web:        'Web stranica',
    inCity:     'u Donjem Miholjcu',
    free:       'Besplatno',
    contact:    'Kontakt',
    upcoming:   'Predstojeće manifestacije u Donjem Miholjcu',
    noEvents:   'Trenutno nema predstojećih manifestacija. Pratite TZ Donji Miholjac za najave!',
    allAccom:   'Evo svih smještajnih opcija u Donjem Miholjcu:',
    hotels:     'Hoteli',
    apts:       'Apartmani',
    pensions:   'Prenoćišta',
    dining:     'Restorani i mjesta za objedovanje u Donjem Miholjcu:',
    cafes:      'Caffe barovi i kavane u Donjem Miholjcu:',
    allGastro:  'Donji Miholjac ima bogatu baranjsko-slavonsku gastronomsku ponudu. Evo pregleda:',
    rests:      'Restorani',
    fastfood:   'Brza hrana i pizzerije',
    cafesH:     'Caffe barovi i kavane',
    health:     '🏥 Zdravstvene ustanove i ljekarne:',
    atm:        '🏧 Banke i bankomati:',
    banks:      '🏦 Banke i pošta:',
    taxi:       '🚕 Taksi prijevoz:',
    bus:        '🚌 Autobusni prijevoz:',
    fuel:       '⛽ Benzinske stanice:',
    parking:    '🅿️ Parkirališta u Donjem Miholjcu:',
    svcOverview:'Pregled usluga dostupnih u Donjem Miholjcu:',
    askMore:    'Pitajte za detalje o bilo kojoj kategoriji!',
    excursions: 'Preporučeni izleti iz Donjeg Miholjca — od najbližeg prema daljem:',
  },
  en: {
    map:        'Open on map',
    more:       'More information',
    tzMore:     'More information at TZ Donji Miholjac',
    web:        'Website',
    inCity:     'in Donji Miholjac',
    free:       'Free',
    contact:    'Contact',
    upcoming:   'Upcoming events in Donji Miholjac',
    noEvents:   'No upcoming events at this time. Follow TZ Donji Miholjac for announcements!',
    allAccom:   'Here are all accommodation options in Donji Miholjac:',
    hotels:     'Hotels',
    apts:       'Apartments',
    pensions:   'Guesthouses',
    dining:     'Restaurants and dining in Donji Miholjac:',
    cafes:      'Cafés in Donji Miholjac:',
    allGastro:  'Donji Miholjac has a rich culinary offer. Here is an overview:',
    rests:      'Restaurants',
    fastfood:   'Fast food & pizzerias',
    cafesH:     'Cafés & coffee bars',
    health:     '🏥 Healthcare & pharmacies:',
    atm:        '🏧 ATMs & banks:',
    banks:      '🏦 Banks & post office:',
    taxi:       '🚕 Taxi services:',
    bus:        '🚌 Bus transport:',
    fuel:       '⛽ Petrol stations:',
    parking:    '🅿️ Parking in Donji Miholjac:',
    svcOverview:'Services available in Donji Miholjac:',
    askMore:    'Ask for details on any category!',
    excursions: 'Recommended day trips from Donji Miholjac — nearest to farthest:',
  },
  de: {
    map:        'Auf der Karte öffnen',
    more:       'Mehr Informationen',
    tzMore:     'Mehr Informationen – TZ Donji Miholjac',
    web:        'Webseite',
    inCity:     'in Donji Miholjac',
    free:       'Kostenlos',
    contact:    'Kontakt',
    upcoming:   'Bevorstehende Veranstaltungen in Donji Miholjac',
    noEvents:   'Derzeit keine bevorstehenden Veranstaltungen. Folgen Sie TZ Donji Miholjac!',
    allAccom:   'Hier sind alle Unterkunftsmöglichkeiten in Donji Miholjac:',
    hotels:     'Hotels',
    apts:       'Apartments',
    pensions:   'Pensionen',
    dining:     'Restaurants und Gastronomie in Donji Miholjac:',
    cafes:      'Cafés in Donji Miholjac:',
    allGastro:  'Donji Miholjac bietet ein reiches kulinarisches Angebot. Hier ein Überblick:',
    rests:      'Restaurants',
    fastfood:   'Schnellimbiss & Pizzerien',
    cafesH:     'Cafés & Kaffeebars',
    health:     '🏥 Gesundheit & Apotheken:',
    atm:        '🏧 Geldautomaten & Banken:',
    banks:      '🏦 Banken & Post:',
    taxi:       '🚕 Taxiservice:',
    bus:        '🚌 Busverbindungen:',
    fuel:       '⛽ Tankstellen:',
    parking:    '🅿️ Parkplätze in Donji Miholjac:',
    svcOverview:'Verfügbare Dienstleistungen in Donji Miholjac:',
    askMore:    'Fragen Sie nach Details zu einer beliebigen Kategorie!',
    excursions: 'Empfohlene Ausflüge ab Donji Miholjac — vom nächsten zum weitesten:',
  },
};

function getRelevantContext(message, db, lastCategory) {
  const msg = message.toLowerCase();

  if (msg.includes('povijest') || msg.includes('histori') || msg.includes('osnovan') || msg.includes('općenito') || msg.includes('o gradu') || msg.includes('o donjem') || msg.includes('o miholjcu') || msg.includes('stanovic') || msg.includes('stanovništv') || msg.includes('geografij') || msg.includes('gospodarsk') || msg.includes('industrij') || msg.includes('poznat') || msg.includes('zanimljiv') || msg.includes('prandau') || msg.includes('majlath') || msg.includes('gradonačelnik') || msg.includes('udaljenost') || msg.includes('baranj') || msg.includes('benicanci') || msg.includes('nafta')
    || msg.includes('history') || msg.includes('about') || msg.includes('general') || msg.includes('population') || msg.includes('founded') || msg.includes('economy') || msg.includes('industry') || msg.includes('famous')
    || msg.includes('geschichte') || msg.includes('über') || msg.includes('einwohner') || msg.includes('wirtschaft'))
    return { context: CATEGORY_CONTEXTS.opcenito(db), category: 'opcenito' };

  if (msg.includes('smještaj') || msg.includes('smjestaj') || msg.includes('hotel') || msg.includes('noćen') || msg.includes('nocen') || msg.includes('apartman') || msg.includes('sobe') || msg.includes('soba') || msg.includes('prenoćiš') || msg.includes('prenocis') || msg.includes('iznajm')
    || msg.includes('accommodation') || msg.includes('sleep') || msg.includes('stay') || msg.includes('room') || msg.includes('bed') || msg.includes('lodge') || msg.includes('hostel')
    || msg.includes('unterkunft') || msg.includes('schlafen') || msg.includes('übernacht') || msg.includes('zimmer'))
    return { context: CATEGORY_CONTEXTS.smjestaj(db), category: 'smjestaj' };

  if (msg.includes('jelo') || msg.includes('restoran') || msg.includes('hrana') || msg.includes('pizza') || msg.includes('jesti') || msg.includes('ručati') || msg.includes('ručak') || msg.includes('večer') || msg.includes('objedovati') || msg.includes('doručak') || msg.includes('kafi') || msg.includes('kav') || msg.includes('bar') || msg.includes('ugostit') || msg.includes('popiti') || msg.includes('napit') || msg.includes('radno vrij') || msg.includes('kada radi') || msg.includes('radi li')
    || msg.includes('restaurant') || msg.includes('food') || msg.includes('eat') || msg.includes('dinner') || msg.includes('lunch') || msg.includes('breakfast') || msg.includes('cafe') || msg.includes('coffee') || msg.includes('drink') || msg.includes('where to eat')
    || msg.includes('essen') || msg.includes('speise') || msg.includes('trinken') || msg.includes('café') || msg.includes('mittagessen'))
    return { context: CATEGORY_CONTEXTS.gastronomija(db), category: 'gastronomija' };

  if (msg.includes('događ') || msg.includes('dogad') || msg.includes('festival') || msg.includes('manifestac') || msg.includes('advent') || msg.includes('program') || msg.includes('što se dešava') || msg.includes('što se događa') || msg.includes('uskoro')
    || msg.includes('prandau festival') || msg.includes('sarmijada') || msg.includes('dm fest') || msg.includes('backyard') || msg.includes('dan grada')
    || msg.includes('event') || msg.includes('events') || msg.includes('carnival') || msg.includes('celebration') || msg.includes('upcoming') || msg.includes('what\'s on')
    || msg.includes('veranstaltung') || msg.includes('fest') || msg.includes('feier'))
    return { context: CATEGORY_CONTEXTS.dogadanja(db), category: 'dogadanja' };

  if (msg.includes('znamenitost') || msg.includes('dvorac') || msg.includes('crkv') || msg.includes('posjet') || msg.includes('vidjeti') || msg.includes('vidjet') || msg.includes('razgled') || msg.includes('što ima') || msg.includes('sto ima') || msg.includes('kapelica') || msg.includes('sakraln') || msg.includes('staro utvrđ') || msg.includes('staro utvrđenje')
    || msg.includes('attraction') || msg.includes('sightseeing') || msg.includes('castle') || msg.includes('museum') || msg.includes('monument') || msg.includes('visit') || msg.includes('landmark') || msg.includes('what to see')
    || msg.includes('sehenswürdigkeit') || msg.includes('burg') || msg.includes('besichtigung'))
    return { context: CATEGORY_CONTEXTS.znamenitosti(db), category: 'znamenitosti' };

  if (msg.includes('vino') || msg.includes('vinar') || msg.includes('graševin') || msg.includes('grasevin') || msg.includes('rizling') || msg.includes('berba') || msg.includes('vinograd') || msg.includes('cellar') || msg.includes('winery') || msg.includes('wine') || msg.includes('wein') || msg.includes('weinberg'))
    return { context: CATEGORY_CONTEXTS.vinarije(db), category: 'vinarije' };

  if (msg.includes('lov') || msg.includes('ribolov') || msg.includes('ribič') || msg.includes('šarani') || msg.includes('šaran') || msg.includes('som') || msg.includes('štuka') || msg.includes('divlj') || msg.includes('jelen') || msg.includes('srna') || msg.includes('svinja') || msg.includes('hunting') || msg.includes('fishing') || msg.includes('angeln') || msg.includes('jagd') || msg.includes('udica')
    || msg.includes('hunt') || msg.includes('fish') || msg.includes('game'))
    return { context: CATEGORY_CONTEXTS.lov(db), category: 'lov' };

  if (msg.includes('sport') || msg.includes('tenis') || msg.includes('nogomet') || msg.includes('fitness') || msg.includes('teretana') || msg.includes('kuglana') || msg.includes('bicikl') || msg.includes('trim') || msg.includes('rekreacij') || msg.includes('cycling') || msg.includes('gym') || msg.includes('fitnessstudio'))
    return { context: CATEGORY_CONTEXTS.sport(db), category: 'sport' };

  if (msg.includes('šetn') || msg.includes('park') || msg.includes('priroda') || msg.includes('drava') || msg.includes('šuma') || msg.includes('stara drava') || msg.includes('bicikl') || msg.includes('rekreacij')
    || msg.includes('walk') || msg.includes('hiking') || msg.includes('nature') || msg.includes('river') || msg.includes('forest') || msg.includes('outdoor')
    || msg.includes('wandern') || msg.includes('radfahren') || msg.includes('natur') || msg.includes('fluss') || msg.includes('wald'))
    return { context: CATEGORY_CONTEXTS.priroda(db), category: 'priroda' };

  if (msg.includes('izlet') || msg.includes('okolica') || msg.includes('blizin') || msg.includes('osijek') || msg.includes('đakovo') || msg.includes('dakovo') || msg.includes('beli manastir') || msg.includes('kopački') || msg.includes('kopacki') || msg.includes('pécs') || msg.includes('pecs') || msg.includes('nasice') || msg.includes('našice') || msg.includes('valpovo') || msg.includes('bizovac') || msg.includes('toplice') || msg.includes('bizovačke')
    || msg.includes('trip') || msg.includes('excursion') || msg.includes('nearby') || msg.includes('surroundings') || msg.includes('day trip')
    || msg.includes('ausflug') || msg.includes('umgebung') || msg.includes('in der nähe'))
    return { context: CATEGORY_CONTEXTS.okolica(db), category: 'okolica' };

  if (lastCategory && CATEGORY_CONTEXTS[lastCategory])
    return { context: CATEGORY_CONTEXTS[lastCategory](db), category: lastCategory, matched: false };

  return { context: db, category: null, matched: false };
}

function getSuggestions(category) {
  const map = {
    smjestaj:     ['🍽️ Gdje ručati?', '🏰 Što vidjeti?', '🍷 Vinarije?'],
    gastronomija: ['🏨 Smještaj?', '🏰 Što vidjeti?', '📅 Događaji?'],
    dogadanja:    ['🏨 Smještaj za tu noć?', '🍽️ Gdje ručati?', '🏰 Što vidjeti?'],
    znamenitosti: ['🍽️ Gdje ručati?', '🏨 Smještaj?', '📅 Događaji?'],
    sport:        ['🍽️ Gdje ručati?', '🌊 Drava i priroda?', '🏨 Smještaj?'],
    vinarije:     ['🍽️ Gdje ručati?', '🦌 Lov i ribolov?', '🗺 Izleti?'],
    lov:          ['🌊 Drava i priroda?', '🍽️ Gdje ručati?', '🏨 Smještaj?'],
    priroda:      ['🍽️ Gdje ručati?', '🦌 Lov i ribolov?', '🏨 Smještaj?'],
    okolica:      ['🏨 Smještaj?', '🍽️ Gdje ručati?', '📅 Događaji?'],
    opcenito:     ['🏰 Što vidjeti?', '🍽️ Gdje ručati?', '🏨 Smještaj?'],
  };
  return map[category] || ['🏰 Što vidjeti?', '🍽️ Gdje ručati?', '🏨 Smještaj?'];
}

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Method not allowed" });
  }

  try {
    const { message, history, category: lastCategory, weather } = req.body;

    if (!message) {
      return res.status(400).json({ reply: "Poruka je prazna." });
    }

    // Warmup ping — odmah vrati, ne zovi OpenAI
    if (message === '__warmup__') {
      return res.status(200).json({ reply: '', category: null, suggestions: [], items: [], images: [] });
    }

    const { context, category, matched = true } = getRelevantContext(message, db, lastCategory);
    const msgLower = message.toLowerCase();
    const lang = detectLang(message);
    const t = TR[lang] || TR.hr;

    // Vremenski upit
    const isWeatherQuery = ['prognoz', 'forecast', 'wetter', 'vremensku prognozu'].some(k => msgLower.includes(k))
      || (['kakvo', 'kako', 'hoće', 'biti', 'temperatura'].filter(k => msgLower.includes(k)).length >= 2 && ['vrij', 'tempera', 'kišno', 'sunčano'].some(k => msgLower.includes(k)));
    if (isWeatherQuery) {
      const reply = `Nažalost, nemam pristup vremenskim podacima.\n\nZa točnu vremensku prognozu preporučujem:\n🌤️ [meteo.hr](https://meteo.hr) — Državni hidrometeorološki zavod\n🌡️ [Weather.com Donji Miholjac](https://weather.com/hr-HR/weather/today/l/Donji+Miholjac)\n\nAko mi kažeš kakvo vrijeme očekuješ — predložit ću aktivnosti koje odgovaraju!`;
      return res.status(200).json({ reply, category: lastCategory || null, suggestions: getSuggestions(lastCategory), images: [] });
    }

    const isRecommendationQuery = ['preporuč', 'savjetuješ', 'savjet', 'što bi', 'sto bi', 'koji bi', 'predloži', 'recommend', 'suggest', 'advice', 'what would you', 'empfehl', 'vorschlag'].some(k => msgLower.includes(k));
    const isDetailQuery = ['zanima me više', 'reci mi više', 'više o', 'više informacij', 'detaljn', 'tko je', 'što je to', 'govori mi o', 'ispričaj mi', 'objasni mi', 'tell me more', 'more about', 'details about', 'who is', 'what is', 'explain', 'erzähl mir mehr', 'mehr über'].some(k => msgLower.includes(k));

    // Direktno listanje (tabovi, brzi gumbi) → uvijek template s karticama
    const isDirectListingRequest = [
      'koji postoje', 'koji ima', 'što postoji', 'prikaži', 'nabroji',
      'svi restorani', 'pregled svih', 'gdje ručati', 'gdje jesti', 'gdje spavati',
      'što se događa', 'show me all', 'list all', 'all restaurants', 'all hotels',
      'where to eat', 'where to stay',
      // Tab gumbi — eksplicitno
      'što vidjeti u donjem miholjcu', 'gdje ručati u donjem miholjcu',
      'smještaj u donjem miholjcu', 'koja događanja se održavaju u donjem miholjcu',
      'vinarije i vino u donjem miholjcu', 'lov i ribolov u donjem miholjcu',
      'rijeka drava i priroda u donjem miholjcu', 'izleti iz donjeg miholjca',
      'korisne informacije o donjem miholjcu'
    ].some(k => msgLower.includes(k));

    // Pitanja o uvjetima, aktivnostima, vremenu → uvijek AI (s vremenskim kontekstom)
    const isActivityQuery = [
      'mogu li', 'da li', 'je li', 'hoće li', 'može li', 'vrijedi li', 'isplati li',
      'što raditi', 'što posjetiti', 'što preporučuješ', 'za vikend', 'sutra', 'ovaj tjedan',
      'can i', 'is it', 'will it', 'should i', 'worth it', 'what to do'
    ].some(k => msgLower.includes(k));

    const conversationHistory = Array.isArray(history) ? history : [];
    // Konverzacijski mod: history >= 2 ILI activity pitanje — ali NE ako je direktno listanje
    const isConversationalMode = (conversationHistory.length >= 2 || isActivityQuery) && !isDirectListingRequest;

    const isGeneralKnowledgeQuery = ['kako se priprema', 'kako se kuha', 'recept', 'recepti', 'sastojci', 'kultura', 'tradicija', 'običaj', 'folklor', 'porijeklo', 'legenda', 'kako doći', 'how to make', 'how to cook', 'recipe', 'ingredients', 'tradition', 'culture', 'how to get', 'wie macht man', 'wie kommt man', 'rezept', 'klima', 'valuta', 'govore li', 'koji jezik', 'vegetar', 'vegan'].some(k => msgLower.includes(k));

    // FAQ pre-gen blokovi
    {
      const ml = msgLower;
      let faqReply = null;

      // 1. TURISTIČKA ZAJEDNICA
      if (!faqReply && (ml.includes('turistič') || ml.includes('info centar') || ml.includes('info punkt') || ml.includes('tourist info') || ml.includes('tz donji') || ml.includes('tz miholjac') || ml.includes('turistički ured'))) {
        faqReply =
          '🏢 **Turistička zajednica Grada Donji Miholjac**\n\n' +
          '📍 Trg Ante Starčevića 2, 31540 Donji Miholjac\n' +
          '📞 +385 31 631 300\n' +
          '✉️ info@tz-donjimiholjac.hr\n' +
          '[Otvori na karti](https://www.google.com/maps/search/?api=1&query=Turisticka+zajednica+Donji+Miholjac)\n' +
          '[Više informacija](https://www.tz-donjimiholjac.hr)';
      }

      // 2. STARA DRAVA / DRAVSKA ŠUMA / RIBOLOV
      if (!faqReply && (ml.includes('stara drava') || ml.includes('dravska') || (ml.includes('drava') && (ml.includes('šuma') || ml.includes('suma') || ml.includes('ribolov') || ml.includes('izletište') || ml.includes('rekreacij'))))) {
        faqReply =
          '🌊 **Stara Drava i Dravske šume — Donji Miholjac**\n\n' +
          'Stara Drava — bivše korito rijeke Drave — **najpopularnije je rekreacijsko područje** u Donjem Miholjcu!\n\n' +
          '🚶 Uređene šetnice uz vodu, piknik mjesta\n' +
          '🎣 Ribolov — šaran, som, štuka, smuđ\n' +
          '🚴 Biciklizam uz obalu\n' +
          '🌲 Dravske šume — stanište jelena, srna i divljih svinja\n' +
          '💶 **Besplatno** za sve posjetitelje\n\n' +
          '[Otvori na karti](https://www.google.com/maps/search/?api=1&query=Stara+Drava+Donji+Miholjac)\n\n' +
          '📞 Više info: +385 31 631 300 | [tz-donjimiholjac.hr](https://www.tz-donjimiholjac.hr)';
      }

      // 3. VINO / VINOGRAD — uputi na Baranju jer DM nije vinorodno područje
      if (!faqReply && (ml.includes('vino') || ml.includes('vinar') || ml.includes('graševin') || ml.includes('grasevin') || ml.includes('vinograd'))) {
        faqReply =
          'ℹ️ Donji Miholjac **nije vinorodno područje** — vinogradi se nalaze u središnjoj Baranji (Beli Manastir, Kneževi Vinogradi, Zmajevac), oko 40 km sjeverno.\n\n' +
          '🗺️ Za baranjska vina i vinograde:\n' +
          '🌐 [tzbaranje.hr](https://www.tzbaranje.hr)\n\n' +
          'U Donjem Miholjcu uživajte u **dravskim specijalitetima** — šaran na dravski način, sarma i domaća rakija!\n' +
          '📞 [+385 31 631 300](tel:+38531631300) | [tz-donjimiholjac.hr](https://www.tz-donjimiholjac.hr)';
      }

      // 4. LOV
      if (!faqReply && (ml.includes('lov') && (ml.includes('šuma') || ml.includes('suma') || ml.includes('divlj') || ml.includes('jelen') || ml.includes('srna') || ml.includes('komercijal') || ml.includes('lovišt') || ml.includes('organizir')) || ml.includes('hunting tourism') || ml.includes('lovna') || ml.includes('lovni'))) {
        faqReply =
          '🦌 **Lovni turizam — Miholjačke Podunavske šume**\n\n' +
          'Donji Miholjac je jedno od najvažnijih lovnih odredišta u Slavoniji i Baranji!\n\n' +
          '🦌 Jelen i jelen lopatar — trofejni primjerci\n' +
          '🐗 Divlja svinja — bogata populacija\n' +
          '🦌 Srna — plemenita divljač\n' +
          '🦆 Patka, fazan, šljuka — perjanica\n' +
          '🌲 Miholjačke Podunavske šume — stanište bogate divljači\n\n' +
          '📞 Za organizaciju lova i lovnih aranžmana:\n' +
          'info@tz-donjimiholjac.hr | [tz-donjimiholjac.hr](https://www.tz-donjimiholjac.hr)';
      }

      // 5. PRANDAU FESTIVAL
      if (!faqReply && (ml.includes('prandau') || ml.includes('festival orgulj') || ml.includes('komorna glazb') || (ml.includes('festival') && ml.includes('glazb')))) {
        faqReply =
          '🎭 **Prandau Festival — Donji Miholjac**\n\n' +
          'Festival orguljaške i komorne glazbe posvećen kulturnoj baštini obitelji Hilleprand-Prandau!\n\n' +
          '📅 **Svibanj — listopad** (višemjesečni festival)\n' +
          '📍 Dvorci i kulturni prostori Donjeg Miholjca i okolice\n\n' +
          '🎻 Klasična glazba u autentičnom ambijentu dvoraca\n' +
          '🏛️ Čuva uspomenu na obitelj Prandau — graditelje Starog dvorca (1818.)\n\n' +
          '[Više informacija](https://www.tz-donjimiholjac.hr)';
      }

      // 6. ZA DJECU / OBITELJ
      if (!faqReply && (ml.includes('djec') || ml.includes('dijete') || ml.includes('obitelj') || ml.includes('kids') || ml.includes('children') || ml.includes('family') || ml.includes('kinder') || ml.includes('s djecom'))) {
        faqReply =
          '👨‍👩‍👧 Donji Miholjac s djecom i obitelju:\n\n' +
          '🌊 **Stara Drava** — Šetnice uz vodu, piknik mjesta, ribolov\n' +
          '🚴 **Biciklizam** — Ravninske staze uz Dravu i kroz šume — savršeno za obitelj!\n' +
          '🌲 **Dravske šume** — Promatranje prirode i divljači\n' +
          '🎭 **Prandau festival** (svibanj–listopad) — Klasična glazba u dvorcu\n' +
          '🏰 **Stari i Novi dvorac** — Povijesni obilazak s djecom\n\n' +
          '📞 Za više info: +385 31 631 300';
      }

      // 7. PLAN POSJETA
      if (!faqReply && (ml.includes('koliko dugo') || ml.includes('koliko vremena') || ml.includes('koliko sati') || ml.includes('how long') || ml.includes('wie lange') || ml.includes('plan posjeta') || ml.includes('vikend plan') || ml.includes('jednodnevni') || (ml.includes('koliko') && (ml.includes('sati') || ml.includes('dana'))))) {
        faqReply =
          '🗺️ Preporučeni plan obilaska Donjeg Miholjca:\n\n' +
          '⏱️ **Poludnevni posjet (3–4 sata):**\n' +
          '✅ Šetnja do Stare Drave — priroda i mir\n' +
          '✅ Stari dvorac (Prandau) — obilazak s vanjske strane\n' +
          '✅ Centar — crkva i kavana s baranjskom kafom\n\n' +
          '☀️ **Cijeli dan (6–8 sati):**\n' +
          '✅ Sve gore + ručak s dravskim šaranom u sarmijadi\n' +
          '✅ Biciklom uz Dravu ili kroz Dravske šume\n' +
          '🏕️ **Vikend u Donjem Miholjcu:**\n' +
          '✅ Sve gore + Kopački rit (55 km) — nezaboravno promatranje ptica\n' +
          '✅ Osijek (45 km) — metropola Slavonije\n\n' +
          '💡 Više informacija: [tz-donjimiholjac.hr](https://www.tz-donjimiholjac.hr)';
      }

      // 8. SUVENIRI
      if (!faqReply && (ml.includes('suvenir') || ml.includes('souvenir') || ml.includes('poklon') || ml.includes('gift') || ml.includes('lokalni proizvod') || ml.includes('suvenirnic'))) {
        faqReply =
          '🎁 Suveniri i lokalni proizvodi iz Donjeg Miholjca:\n\n' +
          '🍯 **Med s Miholjačkog pčelinjaka** — Višecvjetni, bagremov, livadni med\n' +
          '🎀 **Licitar** — Tradicijsko medičarstvo (Jadranka Rušanac — obrt Ban)\n' +
          '🥩 **Slavonska kobasica i kulen** — Sušena, dimljena, tradicijskim receptom\n' +
          '🦌 **Lovački suveniri** — Rogovi, trofejni predmeti\n\n' +
          '🏢 Turistička zajednica Donji Miholjac:\n' +
          '📍 Trg Ante Starčevića 2\n' +
          '📞 +385 31 631 300 | [tz-donjimiholjac.hr](https://www.tz-donjimiholjac.hr)';
      }

      // 9. SARMIJADA
      if (!faqReply && (ml.includes('sarmijada') || ml.includes('sarma') || (ml.includes('natjecanj') && ml.includes('kuha')))) {
        faqReply =
          '🥘 **Sarmijada — Donji Miholjac**\n\n' +
          'Natjecanje u kuhanju sarme — tradicijskog baranjskog jela!\n\n' +
          '📅 **Jesen** — godišnje natjecanje\n' +
          '📍 Donji Miholjac\n\n' +
          '🍃 Sudionici se natječu tko će skuhati najukusniju sarmu po tradicijskom receptu\n' +
          '🎵 Uz veselu glazbu i dobro raspoloženje\n\n' +
          '📞 Informacije: +385 31 631 300 | [tz-donjimiholjac.hr](https://www.tz-donjimiholjac.hr)';
      }

      // 10. KONTAKT / OPĆE
      if (!faqReply && (ml.includes('kontakt') || ml.includes('contact') || ml.includes('telefon tz') || ml.includes('email tz') || ml.includes('info o miholjcu') || ml.includes('informacije o donjem'))) {
        faqReply =
          'ℹ️ Kontakt i informacije o Donjem Miholjcu:\n\n' +
          '🏢 **Turistička zajednica Grada Donji Miholjac**\n' +
          '📍 Trg Ante Starčevića 2, 31540 Donji Miholjac\n' +
          '📞 +385 31 631 300\n' +
          '✉️ info@tz-donjimiholjac.hr\n' +
          '[Više informacija](https://www.tz-donjimiholjac.hr)';
      }

      if (faqReply) {
        return res.status(200).json({
          reply: faqReply,
          category: category || 'opcenito',
          suggestions: getSuggestions(category || 'opcenito'),
          images: []
        });
      }
    }

    // === Strukturirani odgovor (bez AI — brzo) ===
    const resolvedCat = category || lastCategory;

    // O gradu — template bez AI
    if (resolvedCat === 'opcenito' && !isConversationalMode && !isDetailQuery) {
      const s = scrapedContent || {};
      const o = s.o_nama || {};
      const gradOpis = o.grad_opis ? o.grad_opis.substring(0, 500) : '';
      const reply =
        `🏙️ **Donji Miholjac — O gradu**\n\n` +
        `📍 Grad uz rijeku Dravu, na rubu Baranje, u Osječko-baranjskoj županiji\n` +
        `👥 Oko 9.000 stanovnika | Osječko-baranjska županija\n` +
        `🗺️ 45 km od Osijeka | 25 km od Našica\n\n` +
        (gradOpis ? `${gradOpis}\n\n` : '') +
        `**Kontakt i informacije:**\n` +
        `🏢 Turistička zajednica Donjeg Miholjca\n` +
        `📍 Trg Ante Starčevića 2, 31540 Donji Miholjac\n` +
        `📞 [+385 31 631 300](tel:+38531631300)\n` +
        `✉️ info@tz-donjimiholjac.hr\n` +
        `🌐 [tz-donjimiholjac.hr](https://www.tz-donjimiholjac.hr)\n\n` +
        `🌿 Grad poznat po **Dravskim šumama**, lovnom turizmu, ribolovu i Prandau festivalu — festival orguljaške glazbe koji se održava od svibnja do listopada.`;
      return res.status(200).json({
        reply,
        category: 'opcenito',
        suggestions: ['🏰 Što vidjeti?', '🍽️ Gdje ručati?', '🦌 Lov i ribolov?'],
        items: [],
        images: []
      });
    }

    const items = getCategoryItems(resolvedCat);

    if (items.length > 0 && !isConversationalMode && !isGeneralKnowledgeQuery) {
      const intros = {
        gastronomija: `🍽️ **Restorani u Donjem Miholjcu** (${items.length} registriranih objekata pri TZ)\n\nDonji Miholjac poznat je po baranjsko-slavonskoj kuhinji — dravskom šaranu, sarmi i baranjskim kobasicama. Evo svih restorana:`,
        smjestaj:     `🏨 **Smještaj u Donjem Miholjcu** (${items.length} objekata)\n\nApartmani i sobe registrirani pri Turističkoj zajednici — s fotografijama:`,
        znamenitosti: `🏛️ **Kulturna baština Donjeg Miholjca** (${items.length} lokacija)\n\nGlavne atrakcije su **Stari dvorac (Prandau)**, **Novi dvorac (Majlath)** i rekreacijska zona **Stare Drave**. Evo svih lokacija:`,
        priroda:      `🌿 **Turističke atrakcije i rekreacija** (${items.length} lokacija)\n\nDonji Miholjac nudi raznovrsne mogućnosti za aktivan odmor uz rijeku Dravu i u Dravskim šumama:`,
        sport:        `🏃 **Sport i rekreacija u Donjem Miholjcu** (${items.length} lokacija):`,
      };
      const intro = intros[resolvedCat] || `📍 **${items.length} lokacija** u Donjem Miholjcu:`;

      const suggPool = {
        gastronomija: ['Koji restoran ima dravski šaran?', 'Gdje je sarma?', 'Terasa uz Dravu?', 'Preporuka za večeru?', 'Gdje ručati s djecom?', 'Koji restorani rade nedjeljom?'],
        smjestaj:     ['Koji apartman je najbliži centru?', 'Ima li smještaja uz Dravu?', 'Parkiranje uz apartman?', 'Jeftiniji smještaj?', 'Ima li soba za lovce?', 'Kapacitet za grupu?'],
        znamenitosti: ['Dvorac Prandau — info?', 'Stara Drava — gdje?', 'Sakralna baština?', 'Prandau festival — kada?', 'Besplatno razgledavanje?', 'Vođene ture?'],
        priroda:      ['Biciklistička staza uz Dravu?', 'Gdje ići ribolovom?', 'Stara Drava — piknik?', 'Dravske šume — lov?', 'Baranjski vinogradi — gdje?', 'Lov u okolici?'],
        sport:        ['Ribolovna udruga Udica?', 'Teniski tereni?', 'Trim staza — gdje?', 'Fitness centri?', 'Cikloturizam rute?'],
        okolica:      ['Valpovo — dvorac?', 'Bizovačke toplice?', 'Kopački rit — izlet?', 'Osijek — što vidjeti?', 'Đakovo — katedrala?', 'Pécs — Mađarska?'],
        vinarije:     ['Koje sorte vina?', 'Kušanje graševine?', 'Barba berba — kada?', 'Vinograd obilazak?', 'Vinska cesta Baranja?'],
        lov:          ['Lov na jelena?', 'Divlja svinja sezona?', 'Kako organizirati lov?', 'Ribolov na Dravi?', 'Lovački smještaj?'],
      };
      const pool = suggPool[resolvedCat] || getSuggestions(resolvedCat);
      const offset = message.length % Math.max(1, pool.length - 2);
      const suggestions = pool.slice(offset, offset + 3).concat(pool.slice(0, Math.max(0, 3 - (pool.length - offset)))).slice(0, 3);

      return res.status(200).json({
        reply: intro,
        category: resolvedCat,
        suggestions,
        items,
        images: []
      });
    }

    // === AI odgovor (za konverzacijska i složena pitanja) ===
    const contextData = isConversationalMode || isGeneralKnowledgeQuery ? db : context;
    const contextStr = JSON.stringify(stripImages(contextData), null, 1);
    const scrapedSection = buildScrapedSection(resolvedCat);

    const langInstruction = lang === 'en'
      ? 'The user is writing in English. Respond in English.'
      : lang === 'de'
      ? 'Der Benutzer schreibt auf Deutsch. Antworte auf Deutsch.'
      : 'Korisnik piše na hrvatskom. Odgovaraj na hrvatskom.';

    // Pripremi weather/datum kontekst za AI
    const now = new Date();
    const MONTHS = ['siječanj','veljača','ožujak','travanj','svibanj','lipanj','srpanj','kolovoz','rujan','listopad','studeni','prosinac'];
    const DAYS   = ['nedjelja','ponedjeljak','utorak','srijeda','četvrtak','petak','subota'];
    const datumStr = weather?.datum || `${now.getDate()}. ${MONTHS[now.getMonth()]} ${now.getFullYear()}.`;
    const danStr   = weather?.dan   || DAYS[now.getDay()];

    let weatherCtx = `\nTrenutni datum: ${danStr}, ${datumStr}\nSezona: ${['prosinac','siječanj','veljača'].includes(MONTHS[now.getMonth()]) ? 'zima' : ['ožujak','travanj','svibanj'].includes(MONTHS[now.getMonth()]) ? 'proljeće' : ['lipanj','srpanj','kolovoz'].includes(MONTHS[now.getMonth()]) ? 'ljeto' : 'jesen'}`;
    if(weather?.temperature != null){
      weatherCtx += `\nAktualno vrijeme u Donjem Miholjcu: ${weather.icon||''} ${weather.temperature}°C, ${weather.opis||''}, vjetar ${weather.windspeed} km/h`;
    }
    if(weather?.forecast?.length){
      weatherCtx += `\nPrognoza za sljedećih dana:`;
      weather.forecast.slice(0,5).forEach(f => {
        weatherCtx += `\n  ${f.dan} (${f.datum}): ${f.icon} ${f.tmin}–${f.tmax}°C, ${f.opis}${f.kisa ? `, kiša ${f.kisa}%` : ''}`;
      });
    }

    const systemPrompt = `Ti si stručni turistički asistent za grad Donji Miholjac (Hrvatska). Pomažeš posjetiteljima pronaći informacije o znamenitostima, gastronomiji, smještaju, događanjima, lovu, ribolovu i svemu što Donji Miholjac nudi.
${weatherCtx}

VAŽNO — SEZONSKI I VREMENSKI KONTEKST:
• Uvijek koristi aktualni datum i vremensku prognozu u odgovoru
• Za preporuke aktivnosti, izričito navedi sezonu/uvjete: "Budući da je sada ${danStr} i ${weather?.temperature != null ? weather.temperature + '°C' : 'proljeće'}, idealno je..."
• Nikad ne predlažeš ljetne aktivnosti ako je zima, i obrnuto
• Ako korisnik pita za vikend ili nadolazeće dane — referenciraj prognozu iz podataka

${langInstruction}

Koristiš isključivo podatke iz baze i svoja opća znanja o gradu. Budi prijateljski, topao i informativan. Koristi markdown (bold, bullet točke, linkovi na Google Maps).

Baza podataka o Donjem Miholjcu:
${contextStr}
${scrapedSection}

Pravila:
1. Odgovaraj samo na pitanja vezana uz Donji Miholjac i turizam u regiji
2. Ne izmišljaj informacije — ako nešto ne znaš, uputi na TZ (+385 31 631 300)
3. Dravske šume, lovni turizam i ribolov su KLJUČNI identiteti grada — uvijek ih istakni kada je relevantno
3a. VAŽNO: Donji Miholjac NIJE vinorodno područje — ne spominji vinarije, vinograde ni graševinu kao lokalne atrakcije. Ako korisnik pita za vino, uputi ga u Baranju (Beli Manastir, ~40 km)
4. Prandau festival (svibanj–listopad) je najvažnija kulturna manifestacija
5. Šaran na dravski način, sarma i slavonska kobasica i kulen su kulinarski specijaliteti
5a. Za izlete u okolicu UVIJEK navedi web link TZ ili web odredišta kao markdown link — otvara se u skočnom prozoru. Format: [naziv TZ](url). Svako odredište ima web_tz i web_naziv u bazi.
6. UVOD — OBAVEZNO za preporuke i konverzacijska pitanja:
   - NIKAD ne počinji odgovor odmah s listom — uvijek napiši 2-3 rečenice toplog uvoda
   - Uvod mora sadržavati: kontekst sezone/vremena + kratku napomenu o raspoloženju grada + najavu što slijedi
   - Primjer dobrog uvoda: "Odličan izbor! Donji Miholjac u travnju odiše proljetnim mirisima Dravskih šuma — idealno je vrijeme za obilazak. S trenutnom temperaturom od 15°C, preporučujem..."
   - LOŠ uvod (zabranjen): odmah početi s emoji listanjem bez ikakvog konteksta
7. FORMATIRANJE — OBAVEZNO:
   - NIKAD ne koristi ### ili ## za naslove — umjesto toga koristi **Naslov** (bold)
   - NIKAD ne koristi crtice (- stavka) za listanje — uvijek koristi EMOJI ikonu ispred svake stavke
   - Svaka stavka u listi počinje kontekstualnom ikonom: 🏰 dvorac, 🌊 Drava, 🦌 lov, 🎣 ribolov, 🌲 priroda, 🚴 biciklizam, 🎭 kultura, 🍽️ restoran, 🏨 smještaj, 📍 lokacija, 📞 telefon, 🌐 web, 🗺️ izlet, ⛪ crkva, 🎻 glazba itd.
   - Nikad ne ponavljaj istu ikonu uzastopno u listi
8. Na APSOLUTNOM KRAJU odgovora, u zadnjem retku, dodaj TOČNO ovako (bez ikakvog prefiksa, zagrade ili dvotočke ispred, uvijek na HRVATSKOM jeziku):
SUGGESTIONS:["Pitanje 1 na hrvatskom?","Pitanje 2 na hrvatskom?","Pitanje 3 na hrvatskom?"]`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...conversationHistory.slice(-6),
      { role: "user", content: message }
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.7,
      max_tokens: 1100,
    });

    let raw = completion.choices[0]?.message?.content || "Nije moguće generirati odgovor.";

    // Izvuci SUGGESTIONS — tolerira bilo koji prefix ([: , \n, razmak itd.)
    let aiSuggestions = null;
    const sugMatch = raw.match(/(?:\[?:?\s*)SUGGESTIONS:\s*(\[[\s\S]+?\])\s*\]?\s*$/);
    if (sugMatch) {
      try { aiSuggestions = JSON.parse(sugMatch[1]); } catch {}
      raw = raw.slice(0, sugMatch.index).trimEnd();
    }
    // Fallback: ukloni sve što počinje s SUGGESTIONS (ili [...SUGGESTIONS) do kraja
    raw = raw.replace(/\[?:?\s*SUGGESTIONS:[\s\S]*$/, '').trimEnd();

    // Pronađi relevantne stavke sa slikom za AI odgovor
    let aiItems = findRelevantItems(message + ' ' + raw, resolvedCat);
    if (VISUAL_CATS.includes(resolvedCat) && aiItems.length < 2) {
      aiItems = getItemsForCategory(resolvedCat, 6);
    }

    return res.status(200).json({
      reply: raw,
      category: resolvedCat || null,
      suggestions: aiSuggestions || getSuggestions(resolvedCat),
      items: aiItems,
      images: []
    });

  } catch (err) {
    console.error("Chat error:", err);
    return res.status(500).json({ reply: "Greška u komunikaciji sa serverom. Pokušajte ponovno." });
  }
}
