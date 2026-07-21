// ─────────────────────────────────────────────────────────────────────────────
// sector_classify.js — shared SIC → GICS classification for market_universe_full.
//
// Mirrors the manual classification that seeded the table, so newly-absorbed
// tickers get the SAME treatment automatically:
//   1. ETFs / funds / notes            → "ETFs & Funds" bucket
//   2. Warrants / rights / units / pfd → "Warrants/Rights/Units" bucket
//   3. Common stock / ADR with a SIC   → SIC-2digit → GICS, with 4-digit overrides
//   4. Anything left unclassified      → "Unclassified"
//
// SIC descriptions are normalized to a canonical (Title-ish) casing to prevent
// the same industry splitting on casing (Polygon returns CAPS, SEC returns Title).
// ─────────────────────────────────────────────────────────────────────────────

// Instrument-type buckets (non-company)
var FUND_TYPES = { ETF: 1, FUND: 1, ETV: 1, ETN: 1, ETS: 1, SP: 1 };
var DERIV_TYPES = { WARRANT: 1, RIGHT: 1, UNIT: 1, PFD: 1 };
var COMPANY_TYPES = { CS: 1, ADRC: 1 };

var BUCKET_FUNDS = 'ETFs & Funds';
var BUCKET_DERIV = 'Warrants/Rights/Units';
var BUCKET_UNCLASS = 'Unclassified';

// SIC 2-digit major group → GICS sector
var SIC2_TO_GICS = {
  '01': 'Consumer Staples', '02': 'Consumer Staples', '07': 'Industrials', '08': 'Materials', '09': 'Consumer Staples',
  '10': 'Materials', '12': 'Energy', '13': 'Energy', '14': 'Materials',
  '15': 'Industrials', '16': 'Industrials', '17': 'Industrials',
  '20': 'Consumer Staples', '21': 'Consumer Staples', '22': 'Consumer Discretionary', '23': 'Consumer Discretionary',
  '24': 'Materials', '25': 'Consumer Discretionary', '26': 'Materials', '27': 'Communication', '28': 'Materials', '29': 'Energy',
  '30': 'Materials', '31': 'Consumer Discretionary', '32': 'Materials', '33': 'Materials', '34': 'Materials',
  '35': 'Industrials', '36': 'Information Technology', '37': 'Industrials', '38': 'Health Care', '39': 'Consumer Discretionary',
  '40': 'Industrials', '41': 'Industrials', '42': 'Industrials', '43': 'Industrials', '44': 'Industrials', '45': 'Industrials',
  '46': 'Energy', '47': 'Industrials', '48': 'Communication', '49': 'Utilities',
  '50': 'Industrials', '51': 'Industrials', '52': 'Consumer Discretionary', '53': 'Consumer Discretionary',
  '54': 'Consumer Staples', '55': 'Consumer Discretionary', '56': 'Consumer Discretionary', '57': 'Consumer Discretionary',
  '58': 'Consumer Discretionary', '59': 'Consumer Discretionary',
  '60': 'Financials', '61': 'Financials', '62': 'Financials', '63': 'Financials', '64': 'Financials',
  '65': 'Real Estate', '67': 'Financials',
  '70': 'Consumer Discretionary', '72': 'Consumer Discretionary', '73': 'Information Technology', '75': 'Consumer Discretionary',
  '76': 'Industrials', '78': 'Communication', '79': 'Consumer Discretionary',
  '80': 'Health Care', '81': 'Industrials', '82': 'Consumer Discretionary', '83': 'Health Care', '86': 'Communication',
  '87': 'Industrials', '88': 'Financials', '89': 'Industrials', '99': 'Industrials'
};

// 4-digit SIC overrides where the 2-digit group would misclassify (SIC groups don't map 1:1 to GICS)
function sic4Override(sic, groupSector) {
  if (!sic) return groupSector;
  var s2 = sic.slice(0, 2);
  var s3 = sic.slice(0, 3);
  // Real Estate: SIC 65xx (real estate operators/agents/developers) and 6798 (REITs) → Real Estate,
  // even though 67xx as a group maps to Financials.
  if (s2 === '65') return 'Real Estate';
  if (sic === '6798') return 'Real Estate';
  // Drugs / pharma / biologicals (283x) live in SIC group 28 (Chemicals→Materials) but are Health Care
  if (s3 === '283') return 'Health Care';
  // Medical instruments (384x), surgical/medical (385x) → Health Care (group 38 is already HC, keep)
  if (s3 === '384' || s3 === '385') return 'Health Care';
  // Semiconductor / test / lab instruments that belong in Tech
  if (sic === '3559' || sic === '3674' || sic === '3827' || sic === '3825' || sic === '3829') return 'Information Technology';
  // Advertising services (731x) → Communication
  if (s3 === '731') return 'Communication';
  return groupSector;
}

// Normalize a SIC description to a single canonical casing (prevents casing-split industries).
// Prefer Title-case-ish: if it's ALL CAPS, title-case it; otherwise leave as-is.
function canonSicDesc(desc) {
  if (!desc) return desc;
  if (desc === desc.toUpperCase()) {
    // Title-case, then restore common acronyms
    var t = desc.toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    t = t.replace(/\bNec\b/g, 'NEC').replace(/\bTv\b/g, 'Tv');
    return t;
  }
  return desc;
}

// Main: given a ticker's raw fields, return {gics_sector, sector_source, sic_code, sic_description}.
// sic may be null (Polygon/SEC had none). type is Polygon's ticker type.
function classify(type, sic, sicDesc) {
  var out = { sic_code: sic || null, sic_description: sic ? canonSicDesc(sicDesc) : null, gics_sector: null, sector_source: null };

  if (FUND_TYPES[type]) { out.gics_sector = BUCKET_FUNDS; out.sector_source = 'fund'; return out; }
  if (DERIV_TYPES[type]) { out.gics_sector = BUCKET_DERIV; out.sector_source = 'derivative'; return out; }

  // Company (CS/ADRC) or anything else with a SIC → SIC→GICS
  if (sic) {
    var g2 = SIC2_TO_GICS[sic.slice(0, 2)];
    if (g2) {
      out.gics_sector = sic4Override(sic, g2);
      out.sector_source = 'sic_mapped';
      return out;
    }
  }
  // No usable SIC → unclassified (may be a BDC/foreign ADR with no SIC anywhere)
  out.gics_sector = BUCKET_UNCLASS;
  out.sector_source = 'none';
  return out;
}

module.exports = { classify, canonSicDesc, sic4Override, SIC2_TO_GICS, FUND_TYPES, DERIV_TYPES, COMPANY_TYPES };
