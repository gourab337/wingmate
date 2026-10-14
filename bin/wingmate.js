#!/usr/bin/env node
// wingmate CLI. Every command works on the current directory, which holds the user's config, prompts and data.
const fs = require('fs');
const path = require('path');

const HELP = `wingmate: drafts WhatsApp replies in your voice. You read every draft and press Enter yourself.

Usage (run inside your wingmate folder):
  wingmate init      create config.json, CLAUDE.md, style.md, rules.md and data/ here
  wingmate login     open WhatsApp Web once to scan the QR code
  wingmate scrape    copy the chat history into data/history.json
  wingmate facts     build data/facts.md (what each of you has said) from the history
  wingmate start     watch the chat and prefill drafts
  wingmate eval [n]  backtest drafts against your real last n replies (default 20)`;

// Same field order as WhatsApp on this machine: day first (31/12) or month first (12/31).
function localDateOrder() {
  const parts = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'numeric' }).formatToParts(new Date(2026, 11, 31));
  return parts.find((p) => p.type === 'day' || p.type === 'month').type === 'day' ? 'dmy' : 'mdy';
}

function init() {
  const src = path.join(__dirname, '..', 'templates');
  for (const f of fs.readdirSync(src)) {
    if (fs.existsSync(f)) { console.log(`kept     ${f} (already exists)`); continue; }
    let text = fs.readFileSync(path.join(src, f), 'utf8');
    if (f === 'config.json') text = text.replace('"dateOrder": "dmy"', `"dateOrder": "${localDateOrder()}"`);
    fs.writeFileSync(f, text);
    console.log(`created  ${f}`);
  }
  fs.mkdirSync('data', { recursive: true });
  console.log('\nNext: fill in config.json and the <placeholders> in the .md files, then run "wingmate login".');
}

const commands = {
  init,
  login: () => require('../wa').login(),
  scrape: () => require('../scrape-history').scrape(),
  facts: () => require('../facts').refreshFacts().then((n) => console.log(`data/facts.md built from ${n} messages`)),
  start: () => require('../bot').start(),
  eval: (n) => require('../eval').evaluate(+n || 20),
};

const [cmd, ...args] = process.argv.slice(2);
if (!commands[cmd]) { console.log(HELP); process.exit(cmd && cmd !== 'help' && cmd !== '--help' ? 1 : 0); }
Promise.resolve()
  .then(() => commands[cmd](...args))
  .then(() => { if (cmd !== 'start') process.exit(0); })
  .catch((e) => { console.error(`wingmate ${cmd}: ${e.message}`); process.exit(1); });
