// Backtest: draft replies for real past exchanges using only the earlier chat, then compare with what he actually
// sent, both side by side and on measurable style numbers.
const fs = require('fs');
const { generate } = require('./reply');
const { parseTime, at } = require('./config');

function exchanges(h) {
  const blocks = []; // {herStart, herEnd, meEnd}
  for (let i = 0; i < h.length; ) {
    const herStart = i;
    while (i < h.length && h[i].dir === 'in') i++;
    const herEnd = i;
    while (i < h.length && h[i].dir === 'out') i++;
    if (herEnd > herStart && i > herEnd) blocks.push({ herStart, herEnd, meEnd: i });
  }
  return blocks;
}

// Two minutes after her message, so the draft is judged at the time it would have been written.
function replyTime(s) {
  const t = parseTime(s);
  return t ? new Date(+t + 2 * 60e3) : new Date();
}

function style(label, lines) {
  const n = lines.length || 1;
  const pct = (f) => `${Math.round((lines.filter(f).length * 100) / n)}%`.padStart(4);
  const words = lines.map((t) => t.split(/\s+/).length).sort((a, b) => a - b);
  console.log(`${label.padEnd(7)} n=${String(lines.length).padEnd(3)} median words ${String(words[words.length >> 1] ?? 0).padStart(2)} | opens "haha" ${pct((t) => /^haha/i.test(t))} | ends "." ${pct((t) => /[^.]\.$/.test(t))} | comma ${pct((t) => t.includes(','))} | ends "?" ${pct((t) => t.endsWith('?'))} | lol/haha ${pct((t) => /\blol\b|haha/i.test(t))}`);
}

async function evaluate(N = 20) {
  const h = JSON.parse(fs.readFileSync(at('data/history.json'), 'utf8'));
  const test = exchanges(h).slice(-N);
  const drafts = [], reals = [], count = { drafted: 0, escalated: 0, skipped: 0, failed: 0 };
  for (let b = 0; b < test.length; b += 4) {
    await Promise.all(test.slice(b, b + 4).map(async (t, j) => {
      const her = h.slice(t.herStart, t.herEnd).map((m) => m.text).join(' / ');
      const mine = h.slice(t.herEnd, t.meEnd).map((m) => m.text.trim());
      let draft;
      // noFacts: data/facts.md was built from the whole chat, so using it here would leak the answers.
      try { draft = (await generate(h.slice(Math.max(0, t.herEnd - 40), t.herEnd), h.slice(0, t.herStart), { now: replyTime(h[t.herEnd - 1].time), noFacts: true })).text; }
      catch (e) { draft = 'ERR ' + e.message.split('\n')[0]; }
      if (draft.startsWith('ERR')) count.failed++;
      else if (draft.startsWith('ESCALATE')) count.escalated++;
      else if (draft === 'SKIP') count.skipped++;
      else { count.drafted++; drafts.push(...draft.split('\n')); reals.push(...mine); }
      console.log(`#${b + j + 1}\nHER:   ${her.replace(/\n/g, ' ').slice(0, 150)}\nREAL:  ${mine.join(' / ').slice(0, 150)}\nDRAFT: ${draft.replace(/\n/g, ' / ').slice(0, 150)}\n`);
    }));
  }
  console.log(`OUTCOMES over ${test.length}: drafted ${count.drafted}, escalated ${count.escalated}, skipped ${count.skipped}, failed ${count.failed}`);
  console.log('STYLE (real replies vs drafts, on the exchanges that got a draft):');
  style('REAL', reals);
  style('DRAFTS', drafts);
}

module.exports = { evaluate };
