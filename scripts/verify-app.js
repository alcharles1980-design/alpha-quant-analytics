// Reusable headless-verification harness.
//
// WHY THIS IS COMMITTED. This boilerplate was rewritten ~82 times in one session in a sandbox that
// does not survive into a new environment. The scripts themselves were throwaway; the SETUP and the
// DISCIPLINES were not. §4a is the rulebook — this is the tooling that makes following it cheap.
//
// SETUP in a fresh sandbox (once):
//     mkdir -p ~/pwtest && cd ~/pwtest && npm install playwright-core
//     # Chromium ships at /opt/pw-browsers/chromium-*/chrome-linux/chrome
// Then require this file from a script in that directory, or copy it alongside.
//
// USAGE
//     const { open, table, sampleOverTime } = require('/path/to/verify-app.js');
//     const { browser, page } = await open('#mostactives', { wait: 26000 });
//     const t = await table(page);           // headers + rows as text
//     await browser.close();
//
// THREE DISCIPLINES THIS ENCODES — each one cost a shipped bug:
//   1. capturePayloads: compare the RENDERED cell against the JSON THE PAGE ITSELF CONSUMED, not
//      against a fresh API call. Removes timing drift entirely; 418 assertions were settled this way.
//   2. sampleOverTime: a defect on a FIXED CADENCE is invisible to a spot check. v656 shipped with
//      the live columns being wiped on every table reload and passed four single-sample checks.
//   3. Positive control: a probe returning zero proves nothing until it has reported something you
//      already know is present. Two bugs were misdiagnosed for want of this.

const fs = require('fs');

// playwright-core is NOT a dependency of this repo — it is installed once per sandbox in a scratch
// directory (see SETUP above), so a plain require() fails when this file is run from the repo. Try
// the usual places rather than forcing the caller to care. Caught by actually running the harness:
// the first committed version threw MODULE_NOT_FOUND.
function loadPlaywright() {
  const candidates = [
    'playwright-core',
    process.env.PW_MODULE,
    '/home/claude/pwtest/node_modules/playwright-core',
    `${process.env.HOME || '/home/claude'}/pwtest/node_modules/playwright-core`,
  ].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch (e) { /* try next */ }
  }
  throw new Error(
    'playwright-core not found. Install it once per sandbox:\n' +
    '  mkdir -p ~/pwtest && cd ~/pwtest && npm install playwright-core\n' +
    'or set PW_MODULE to its path.');
}
const { chromium } = loadPlaywright();

const APP_URL = 'https://alpha-quant-analytics.alcharles1980.workers.dev/';
const ACCESS_CODE = 'BT';

function chromePath() {
  const dir = fs.readdirSync('/opt/pw-browsers').find(d => d.startsWith('chromium-'));
  if (!dir) throw new Error('no chromium in /opt/pw-browsers — run: npm install playwright-core');
  return `/opt/pw-browsers/${dir}/chrome-linux/chrome`;
}

// Opens the app, logs in, navigates to a hash route. Returns { browser, page, errors, payloads }.
// `errors` collects pageerror events — note Recharts always throws a PropTypes `oneOfType` error
// headless (window.Recharts is undefined); that one is EXPECTED and is not a fault.
async function open(hash, opts = {}) {
  const { wait = 24000, width = 2100, height = 1300, capturePayloads = false } = opts;
  const browser = await chromium.launch({
    executablePath: chromePath(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 160)));
  const payloads = [];
  if (capturePayloads) {
    page.on('response', async r => {
      const path = r.request().headers()['x-alpaca-path'] || r.url();
      if (!/\/v2\/stocks\/|\/rest\/v1\//.test(path)) return;
      let json; try { json = await r.json(); } catch (e) { return; }
      payloads.push({ path, status: r.status(), json, at: Date.now() });
    });
  }
  await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 90000 });
  await page.fill('input', ACCESS_CODE);
  await page.click('button');
  await page.waitForTimeout(2000);
  if (hash) {
    await page.evaluate(h => { window.location.hash = h; }, hash);
    await page.waitForTimeout(wait);
  }
  return { browser, page, errors, payloads };
}

// Reads the visible table as headers + rows of trimmed text. Deliberately returns TEXT: verifying
// what a human would actually read is the point (v646 shipped a cell rendering `315.29x4025s` —
// fully populated, updating, and unreadable).
async function table(page) {
  return page.evaluate(() => {
    const headers = [...document.querySelectorAll('th')].map(t => t.innerText.replace(/\s+/g, ' ').trim());
    const rows = [...document.querySelectorAll('tbody tr')].map(tr =>
      [...tr.children].map(td => td.innerText.replace(/\s+/g, ' ').trim()));
    return { headers, rows };
  });
}

// Finds a column index by header prefix. Returns -1 if absent, which callers must treat as a
// FAILING assertion rather than skipping the check.
function col(headers, prefix) {
  return headers.findIndex(h => h.startsWith(prefix));
}

// Clicks a session tab (or any button) by visible-text prefix. Returns the text actually clicked so
// the caller can assert it hit the intended control — v638 lost time to a probe that clicked
// "Refresh" while believing it had clicked the auto-refresh toggle.
async function clickButton(page, prefix, maxLen = 24) {
  return page.evaluate(([p, m]) => {
    const b = [...document.querySelectorAll('button')]
      .find(x => x.innerText.trim().length < m && new RegExp('^' + p, 'i').test(x.innerText.trim()));
    if (!b) return null;
    b.click();
    return b.innerText.trim();
  }, [prefix, maxLen]);
}

// Samples a reader repeatedly. USE THIS, NOT A SINGLE SNAPSHOT, for anything that could be wiped or
// refreshed on a cadence. Returns every sample so the caller can assert on the WORST one.
async function sampleOverTime(page, readFn, { every = 5000, times = 12 } = {}) {
  const out = [];
  for (let i = 0; i < times; i++) {
    out.push({ t: i * every / 1000, value: await page.evaluate(readFn) });
    if (i < times - 1) await page.waitForTimeout(every);
  }
  return out;
}

module.exports = { open, table, col, clickButton, sampleOverTime, APP_URL, ACCESS_CODE, chromePath };
