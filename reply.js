const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const cfg = require('./config.json');
const { me: ME, them: THEM } = cfg.names; // display names used in prompts, kept out of git
// Prompt files are read on every draft, so edits to them apply without restarting the bot.
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
// data/facts.md is built by facts.js from the whole chat: what he has actually told her about himself.
const facts = () => { try { return read('data/facts.md'); } catch { return ''; } };
const knownFacts = (useFacts) => (read('CLAUDE.md').match(/^## Known facts[\s\S]*?(?=^## )/m) || [''])[0] + '\n' + (useFacts ? facts() : '');

const loadHistory = () => JSON.parse(read('data/history.json'));

// Real past exchanges (her message block -> his reply block) so drafts copy his actual voice.
function realExamples(h) {
  const pairs = [];
  for (let i = 0; i < h.length; ) {
    const her = [], me = [];
    while (i < h.length && h[i].dir === 'in') her.push(h[i++].text);
    while (i < h.length && h[i].dir === 'out') me.push(h[i++].text);
    if (her.length && me.length && her.join(' ').length < 400 && me.join(' ').length < 250)
      pairs.push(`${THEM}: ${her.join(' / ')}\n${ME}: ${me.join(' / ')}`);
  }
  return pairs.join('\n\n');
}

// How he actually texts, measured from his own messages, plus his latest ones verbatim.
function voice(h) {
  const mine = h.filter((m) => m.dir === 'out').map((m) => m.text.trim());
  const pct = (f) => Math.round((mine.filter(f).length * 100) / mine.length);
  const words = mine.map((t) => t.split(/\s+/).length).sort((x, y) => x - y);
  return `HIS TEXTING, MEASURED over his ${mine.length} messages. A draft that breaks these numbers reads as AI:
- Median ${words[words.length >> 1]} words; ${pct((t) => t.split(/\s+/).length <= 3)}% are 3 words or fewer.
- Opens with "haha": ${pct((t) => /^haha/i.test(t))}%. "lol"/"haha" are in only ${pct((t) => /\blol\b|haha/i.test(t))}% of messages, at the END of a line.
- Ends on a full stop: ${pct((t) => /[^.]\.$/.test(t))}%. Contains a comma: ${pct((t) => t.includes(','))}%.
- Ends with a question mark: ${pct((t) => t.endsWith('?'))}%. The rest are statements.

HIS MOST RECENT MESSAGES, verbatim (how he is texting right now, including his Banglish):
${mine.slice(-30).map((t) => '- ' + t.replace(/\n+/g, ' / ')).join('\n')}`;
}

const buildSystem = (corpus, useFacts) => `You write WhatsApp replies as ${ME} to a girl he is dating (${THEM}). Match his texting style exactly.

${read('style.md')}

${voice(corpus)}

${read('CLAUDE.md')}

FACTS (extracted from the whole chat; the only things you may state about his life beyond Known facts):
${useFacts ? facts() : '(none yet)'}

REAL EXAMPLES of how ${ME} actually replied (copy this voice, not generic banter):

${realExamples(corpus)}

Rules:
${read('rules.md')}`;

// After a failed call (usually the account's usage limit) stop calling claude for a while, instead of
// spawning a doomed process on every poll. The pause doubles up to 30 minutes and resets on success.
let pausedUntil = 0, pause = 2 * 60e3;

function run(system, prompt, model = cfg.model || 'sonnet') {
  if (Date.now() < pausedUntil)
    return Promise.reject(new Error(`claude calls paused until ${new Date(pausedUntil).toLocaleTimeString('en-AU')} after a failure`));
  return new Promise((resolve, reject) => {
    const p = spawn('claude', [
      '-p', '--model', model, '--tools', '', '--system-prompt', system,
      '--setting-sources', '', '--no-session-persistence', '--disable-slash-commands',
    ], { cwd: path.join(__dirname, 'data') });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => {
      if (code === 0) { pause = 2 * 60e3; return resolve(out.trim()); }
      pausedUntil = Date.now() + pause;
      pause = Math.min(pause * 2, 30 * 60e3);
      reject(new Error(`claude exited ${code}: ${(err || out).trim().slice(0, 200) || 'no output'}`)); // the limit message arrives on stdout
    });
    p.stdin.end(prompt);
  });
}

// Each line carries when it was sent, e.g. "[7:32 pm, 11/10/2026] Name: ..." (dd/mm/yyyy, Sydney time).
const stamp = (m) => (m.time.match(/\[[^\]]+\]/) || [''])[0];
const transcriptOf = (history) =>
  history.map((m) => `${stamp(m)} ${m.dir === 'in' ? THEM : ME}: ${m.text}${m.reaction ? `  [${m.dir === 'out' ? THEM : ME} reacted ${m.reaction}]` : ''}`.trim()).join('\n');

// ctx: { recentModes: ['R','A','N',..], openers: {her, him}, initiate: hoursOfSilence }
function contextNote(ctx = {}) {
  const notes = [];
  if (ctx.recentModes?.length) {
    const last4 = ctx.recentModes.slice(-4);
    notes.push(`Modes of his last messages (oldest first): ${ctx.recentModes.join(' ')}.` +
            (last4.slice(-2).join('') === 'AA' ? ' The last two were attraction: go rapport or neutral this time.' : ''));
  }
  if (ctx.openers) notes.push(`Who started recent conversations: her ${ctx.openers.her}, him ${ctx.openers.him}. Don't over-chase; let her initiate too.`);
  return notes.length ? '\n\n' + notes.join('\n') : '';
}

// He almost never opens with "haha" (1 of ~155 messages) and never ends a message on a full stop, so enforce both.
function tidy(line) {
  const t = line.replace(/^(ha){2,}h?[\s,!.]*/i, '').replace(/([^.])\.$/, '$1');
  return t ? (t === line ? t : t[0].toUpperCase() + t.slice(1)) : line;
}

function parse(out) {
  const m = out.match(/\n?MODE:\s*([RAN])\s*$/i);
  const text = m ? out.slice(0, m.index).trim() : out.trim();
  const mode = m ? m[1].toUpperCase() : null;
  if (/^(SKIP|ESCALATE)/.test(text)) return { text, mode };
  return { text: text.split('\n').map((l) => tidy(l.trim())).filter(Boolean).join('\n'), mode };
}

async function generateRaw(history, corpus, ctx) {
  const task = ctx?.initiate
    ? `It's been about ${Math.round(ctx.initiate)} hours since anyone texted. Write ${ME}'s message to START a conversation. Ground it in something real from the chat (a callback, a plan to follow up on, a light observation). Not just "hey". If nothing natural comes to mind, output SKIP.`
    : `Write ${ME}'s next reply.`;
  const prompt = `Chat so far (oldest first, current time ${(ctx?.now || new Date()).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}, Sydney):\n\n${transcriptOf(history)}${contextNote(ctx)}${ctx?.retryNote ? '\n\n[NOTE: your previous draft was rejected for saying something unsupported (' + ctx.retryNote + '). Redo it without that, vaguer or shorter.]' : ''}${ctx?.rejected?.length ? '\n\n[NOTE: he deleted these drafts for this message, so do not reword them. Take a different angle:\n' + ctx.rejected.map((d) => '- ' + d).join('\n') + ']' : ''}\n\n${task}`;
  return parse(await run(buildSystem(corpus, !ctx?.noFacts), prompt));
}

// Fact-check pass: reject drafts that invent places, times, plans or facts about his life.
async function supported(history, draft, useFacts) {
  const verdict = await run(
    `You are a strict fact-checker. Given known facts, a chat and a proposed reply from ${ME}, answer with exactly OK if every concrete claim in the reply (places, times, plans, commitments, events, facts about his life, location or schedule) is established in the chat or the known facts, or is generic small talk. Warm feelings toward her and looking forward to seeing her are fine and need no support. Otherwise answer exactly FAIL: <the unsupported claim>.`,
    `${knownFacts(useFacts)}\nChat:\n${transcriptOf(history)}\n\nProposed reply:\n${draft}`,
    cfg.checkModel || 'sonnet'
  );
  return verdict.startsWith('OK') ? null : verdict;
}

// Returns { text, mode }. text may be SKIP or ESCALATE: ...
// corpus = the chat history used for examples and voice stats (the whole saved chat unless a backtest narrows it).
async function generate(history, corpus = loadHistory(), ctx = {}) {
  let r = await generateRaw(history, corpus, ctx);
  if (/^(SKIP|ESCALATE)/.test(r.text)) return r;
  for (let i = 0; i < 2; i++) {
    const bad = await supported(history, r.text, !ctx.noFacts);
    if (!bad) return r;
    r = await generateRaw(history, corpus, { ...ctx, retryNote: bad });
    if (/^(SKIP|ESCALATE)/.test(r.text)) return r;
  }
  return { text: 'ESCALATE: draft kept inventing facts || NONE', mode: null };
}

module.exports = { generate, run, transcriptOf, tidy, voice };
