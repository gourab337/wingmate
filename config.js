// Loads config.json from the user's wingmate folder (the current directory) and fails fast on bad settings.
const fs = require('fs');
const path = require('path');

const HOME = process.cwd();
const file = path.join(HOME, 'config.json');
if (!fs.existsSync(file)) throw new Error(`No config.json in ${HOME}. Run "wingmate init" here first.`);
const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));

if (!['prefill', 'approve'].includes(cfg.mode)) throw new Error(`config.json: "mode" must be "prefill" or "approve", got ${JSON.stringify(cfg.mode)}`);
if (!cfg.names?.me || !cfg.names?.them) throw new Error('config.json: set "names": { "me": ..., "them": ... }');
if (!cfg.contact) throw new Error('config.json: set "contact" to the chat name exactly as WhatsApp shows it');
if (!['dmy', 'mdy'].includes(cfg.dateOrder)) throw new Error('config.json: "dateOrder" must be "dmy" (31/12/2026) or "mdy" (12/31/2026), matching WhatsApp on your phone');

// WhatsApp stamps each message like "[7:32 pm, 31/12/2026] Name: " or "[19:32, 12/31/26] Name: ", in local time.
function parseTime(s) {
  const m = s.match(/\[(\d+):(\d+)\s*([ap]\.?\s?m\.?)?,\s*(\d+)[./-](\d+)[./-](\d+)\]/i);
  if (!m) return null;
  let h = +m[1];
  if (m[3]) h = (h % 12) + (/^p/i.test(m[3]) ? 12 : 0);
  const [d, mo] = cfg.dateOrder === 'dmy' ? [+m[4], +m[5]] : [+m[5], +m[4]];
  const y = +m[6] < 100 ? 2000 + +m[6] : +m[6];
  return new Date(y, mo - 1, d, h, +m[2]);
}

const at = (f) => path.join(HOME, f);

module.exports = { cfg, parseTime, at, HOME };
