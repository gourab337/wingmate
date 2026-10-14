const fs = require('fs');
const readline = require('readline/promises');
const { execFile } = require('child_process');
const { launch, openChat, readMessages, send, composerText, prefill, clearComposer } = require('./wa');
const { generate } = require('./reply');
const { refreshFacts } = require('./facts');
const cfg = require('./config.json');

const STATE = 'data/state.json';
const state = Object.assign({ handled: null, day: '', sent: 0, modes: [], initDay: '' },
  fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE)) : {});
const save = () => fs.writeFileSync(STATE, JSON.stringify(state));
const log = (o) => fs.appendFileSync('data/log.jsonl', JSON.stringify({ at: new Date().toISOString(), ...o }) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (m) => `${m.time}|${m.text}`;
const tty = process.stdin.isTTY;
const rl = tty ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;

// "[1:31 pm, 11/10/2026] Name: " -> Date (WhatsApp shows dd/mm/yyyy in local time)
function parseTime(s) {
  const m = s.match(/\[(\d+):(\d+)\s*(am|pm),\s*(\d+)\/(\d+)\/(\d+)\]/i);
  if (!m) return null;
  let h = +m[1] % 12; if (m[3].toLowerCase() === 'pm') h += 12;
  return new Date(+m[6], +m[5] - 1, +m[4], h, +m[2]);
}

// What the bot currently sees, so its state can be checked without opening a second browser.
const status = (o) => fs.writeFileSync('data/status.json', JSON.stringify({ at: new Date().toLocaleString('en-AU'), ...o }, null, 1));

// Grow data/history.json from what the bot sees live, so his real replies become examples for later drafts.
const HIST = 'data/history.json';
const plain = (m) => `${m.time}|${m.text.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim()}`; // old rows have no emoji
function absorb(msgs) {
  const hist = JSON.parse(fs.readFileSync(HIST));
  const lastT = parseTime(hist[hist.length - 1].time);
  const have = new Set(hist.slice(-300).map(plain));
  const fresh = msgs.filter((m) => { const t = parseTime(m.time); return t && t >= lastT && !have.has(plain(m)); });
  if (fresh.length) fs.writeFileSync(HIST, JSON.stringify([...hist, ...fresh], null, 2));
  histLen = hist.length + fresh.length;
}

// Rebuild the memory profile (data/facts.md) in the background: every 60 new messages, at most every 30 minutes.
// It sends the whole chat, so it is the most expensive call the bot makes.
let histLen = 0, refreshing = false, factsNotBefore = 0;
function maybeRefreshFacts() {
  if (refreshing || Date.now() < factsNotBefore || histLen - (state.factsAt || 0) < 60) return;
  refreshing = true;
  factsNotBefore = Date.now() + 30 * 60e3;
  refreshFacts().then((n) => { state.factsAt = n; save(); log({ event: 'facts-refreshed', messages: n }); })
    .catch((e) => log({ event: 'facts-failed', error: e.message.split('\n')[0] }))
    .finally(() => { refreshing = false; });
}

const notify = (title, body) =>
  execFile('osascript', ['-e', `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`], () => {});

// Messages that appeared after the one with key `baseKey`, or null if that message is no longer loaded.
function messagesSince(msgs, baseKey) {
  const i = msgs.map(key).lastIndexOf(baseKey);
  return i === -1 ? null : msgs.slice(i + 1);
}

// A draft currently sitting in the WhatsApp box, waiting for him to press Enter.
let pending = null; // { lines, mode, her, baseKey, emptyPolls }
const rejected = {}; // her-message key -> drafts he deleted for it

// Prefill mode: type the draft into the box (never sends) and tell him.
async function offerDraft(page, msgs, lines, mode, her, kind) {
  // He may have started typing while the draft was being written: never type into his own message.
  if (await composerText(page)) return log({ event: 'prefill-skipped', reason: 'he is typing', draft: lines });
  try { await prefill(page, lines); }
  catch (e) { return log({ event: 'prefill-failed', error: e.message.split('\n')[0], draft: lines }); }
  pending = { lines, mode, her, baseKey: key(msgs[msgs.length - 1]), emptyPolls: 0 };
  log({ event: kind, her, draft: lines, mode });
  notify('Draft ready', lines.join(' / '));
  console.log(`Prefilled: ${lines.join(' / ')}`);
}

// Learn from what he actually sent, clear a stale draft if she texted again, and notice a deleted draft.
// Returns true when he deleted the draft and a different one should be written.
async function reviewPending(page, msgs) {
  if (!pending) return false;
  const fresh = messagesSince(msgs, pending.baseKey);
  if (!fresh) { pending = null; return false; } // baseline scrolled out of the loaded chat; stop tracking
  const sent = fresh.filter((m) => m.dir === 'out').map((m) => m.text);
  if (sent.length) {
    const flat = (a) => a.join(' ').replace(/\s+/g, ' ').trim(); // a two-line draft is sent as one message with a line break
    log({ event: 'sent-by-user', draft: pending.lines, actual: sent, edited: flat(sent) !== flat(pending.lines) });
    if (pending.mode) { state.modes = [...state.modes, pending.mode].slice(-10); save(); }
    pending = null;
  } else if (fresh.some((m) => m.dir === 'in')) {
    if ((await composerText(page)).replace(/\s+/g, ' ') === pending.lines.join(' ')) // untouched draft is stale
      await clearComposer(page).catch((e) => log({ event: 'clear-failed', error: e.message.split('\n')[0] }));
    log({ event: 'draft-stale', draft: pending.lines });
    pending = null;
  } else if (!(await composerText(page))) {
    // Box emptied with nothing sent: he deleted the draft. Wait one more poll in case his send hasn't rendered yet.
    if (++pending.emptyPolls < 2) return false;
    const tries = (rejected[pending.her] ||= []);
    tries.push(pending.lines.join(' / '));
    log({ event: 'draft-rejected', draft: pending.lines });
    pending = null;
    return tries.length <= 2; // offer a different angle, at most twice per message
  } else pending.emptyPolls = 0;
  return false;
}

function blocked() {
  if (fs.existsSync('PAUSE')) return 'PAUSE file present';
  const h = new Date().getHours(), { start, end } = cfg.quietHours;
  if (cfg.mode !== 'prefill' && h >= start && h < end) return 'quiet hours'; // prefill never sends, so it can draft any time
  const today = new Date().toDateString();
  if (state.day !== today) { state.day = today; state.sent = 0; }
  if (state.sent >= cfg.maxSendsPerDay) return 'daily cap reached';
  return null;
}

// Who started recent conversations (first message after a >3h gap).
function openers(msgs) {
  const o = { her: 0, him: 0 };
  let prev = null;
  for (const m of msgs) {
    const t = parseTime(m.time);
    if (t && (!prev || t - prev > 3 * 3600e3)) o[m.dir === 'in' ? 'her' : 'him']++;
    if (t) prev = t;
  }
  return o;
}

// No terminal (run by Claude in the background): drafts go to data/pending.json and wait for data/decision.json
// {"action":"send"|"skip"|"edit","text":"msg one || msg two"}.
async function approveViaFiles(lines) {
  const PEND = 'data/pending.json', DEC = 'data/decision.json';
  if (fs.existsSync(DEC)) fs.unlinkSync(DEC);
  fs.writeFileSync(PEND, JSON.stringify({ lines, at: new Date().toISOString() }));
  console.log('\n--- DRAFT (awaiting approval) ---\n' + lines.join('\n') + '\n---------------------------------');
  while (!fs.existsSync(DEC)) {
    if (fs.existsSync('PAUSE')) { fs.unlinkSync(PEND); return null; }
    await sleep(1000);
  }
  const d = JSON.parse(fs.readFileSync(DEC)); fs.unlinkSync(DEC); fs.unlinkSync(PEND);
  if (d.action === 'send') return lines;
  if (d.action === 'edit' && d.text) return d.text.split(' || ');
  return null;
}

async function approve(lines) {
  if (!tty) return approveViaFiles(lines);
  console.log('\n--- DRAFT ---\n' + lines.join('\n') + '\n-------------');
  const a = (await rl.question('[Enter]=send  e=edit  s=skip : ')).trim().toLowerCase();
  if (a === 's') return null;
  if (a === 'e') {
    const t = (await rl.question('Your text (use " || " to split into multiple messages): ')).trim();
    return t ? t.split(' || ') : null;
  }
  return lines;
}

async function deliver(page, lines, mode, event, extra) {
  const [lo, hi] = cfg.replyDelaySeconds;
  await sleep((lo + Math.random() * (hi - lo)) * 1000);
  for (const l of lines) { await send(page, l); await sleep(1500 + Math.random() * 2500); }
  state.sent += lines.length;
  if (mode) state.modes = [...state.modes, mode].slice(-10);
  save();
  log({ event, sent: lines, mode, ...extra });
  console.log('Sent.');
}

let draftError = null; // why drafting is failing right now (shown in data/status.json), or null

async function reply(page, msgs, last) {
  const why = blocked();
  if (why) return console.log(`Not replying (${why}).`);
  if (cfg.mode === 'prefill' && (await composerText(page))) return; // he's typing; try again next poll, don't mark handled
  let r;
  try { r = await generate(msgs.slice(-40), undefined, { recentModes: state.modes, openers: openers(msgs), rejected: rejected[key(last)] }); }
  catch (e) {
    const error = e.message.split('\n')[0];
    if (!draftError) { // tell him once, not on every poll
      notify('Bot cannot draft right now', error.slice(0, 120));
      log({ event: 'generate-failed', error });
      console.error('generate failed:', error);
    }
    draftError = error;
    return;
  }
  if (draftError) { log({ event: 'generate-recovered' }); draftError = null; }

  const done = () => { state.handled = key(last); save(); };
  const out = r.text;
  if (out === 'SKIP') { done(); log({ event: 'skip', her: last.text }); return console.log('Skipped (no reply needed).'); }

  let lines;
  if (out.startsWith('ESCALATE')) {
    const [reason, suggestion] = out.split('||').map((x) => x.trim());
    done(); log({ event: 'escalate', her: last.text, out });
    console.log(`\n!! NEEDS YOU: "${last.text}"\n   ${reason}`);
    if (cfg.mode === 'prefill') return notify('Needs you', `${last.text.slice(0, 80)} | ${reason}`);
    if (cfg.mode !== 'approve' || !suggestion || suggestion === 'NONE') return; // never auto-send on escalation
    console.log('   (optional minimal acknowledgement below; edit or skip)');
    lines = [suggestion];
  } else lines = out.split('\n').map((l) => l.trim()).filter(Boolean);

  if (cfg.mode === 'prefill') { done(); return offerDraft(page, msgs, lines, r.mode, key(last), 'prefilled'); }
  if (cfg.mode === 'approve') lines = await approve(lines);
  done();
  if (!lines) return log({ event: 'rejected', her: last.text, out });
  await deliver(page, lines, r.mode, 'sent', { her: last.text });
}

// Hours of silence if an opener is due at `now`, else null: only after real silence, in daytime, max once a day.
function openerDue(now, last, c, initDay) {
  const t = last && parseTime(last.time);
  if (!c?.enabled || !t || initDay === now.toDateString()) return null;
  const hours = (now - t) / 3600e3;
  const need = last.dir === 'out' ? c.silenceHours * 2 : c.silenceHours; // wait longer if he spoke last
  const h = now.getHours();
  return hours >= need && h >= c.windowStart && h < c.windowEnd ? hours : null;
}

let initAt = null;
async function maybeInitiate(page, msgs) {
  const c = cfg.initiate;
  const last = msgs[msgs.length - 1];
  if (cfg.mode === 'prefill' && (pending || (await composerText(page)))) return; // a draft is already waiting, or he's typing
  const hours = openerDue(new Date(), last, c, state.initDay);
  if (hours === null || blocked()) { initAt = null; return; }
  if (!initAt) { initAt = Date.now() + Math.random() * c.maxJitterMinutes * 60e3; return; }
  if (Date.now() < initAt) return;

  initAt = null;
  state.initDay = new Date().toDateString(); save(); // one attempt per day
  let r;
  try { r = await generate(msgs.slice(-40), undefined, { recentModes: state.modes, openers: openers(msgs), initiate: hours }); }
  catch (e) { return console.error('generate failed:', e.message); }
  if (r.text === 'SKIP' || r.text.startsWith('ESCALATE')) return log({ event: 'init-skip', out: r.text });

  let lines = r.text.split('\n').map((l) => l.trim()).filter(Boolean);
  console.log(`\n(Silence ${hours.toFixed(1)}h: drafting an opener)`);
  if (cfg.mode === 'prefill') return offerDraft(page, msgs, lines, r.mode, key(last), 'init-prefilled');
  if (cfg.mode === 'approve') lines = await approve(lines);
  if (!lines) return log({ event: 'init-rejected', out: r.text });
  await deliver(page, lines, r.mode, 'initiated', {});
}

async function session() {
  const { context, page } = await launch();
  try {
    await openChat(page, cfg.contact);
    console.log(`Watching "${cfg.contact}" in ${cfg.mode} mode. Create a file named PAUSE to stop replies.`);
    let candidate = null, seenPolls = 0;
    while (true) {
      await sleep(cfg.pollSeconds * 1000);
      const msgs = await readMessages(page, cfg.contact);
      const last = msgs[msgs.length - 1];
      if (!last) continue;
      absorb(msgs);
      maybeRefreshFacts();
      const redraft = await reviewPending(page, msgs);
      status({
        lastSeen: msgs.slice(-4).map((m) => `${m.dir} ${m.time.trim()} ${m.text.slice(0, 90)}${m.reaction ? ` [reaction ${m.reaction}]` : ''}`),
        composer: await composerText(page), pendingDraft: pending?.lines || null, handled: state.handled, draftError,
      });

      if (redraft && last.dir === 'in') { await reply(page, msgs, last); continue; } // he deleted the draft: new angle now
      // A reaction on her message is his (1:1 chat): he has acknowledged it, so don't draft a reply to it.
      if (last.dir !== 'in' || key(last) === state.handled || last.reaction) { candidate = null; await maybeInitiate(page, msgs); continue; }

      // debounce: only act once she has stopped sending for `debouncePolls` polls
      if (candidate === key(last)) seenPolls++; else { candidate = key(last); seenPolls = 1; }
      if (seenPolls < cfg.debouncePolls) continue;
      await reply(page, msgs, last);
    }
  } finally {
    await context.close().catch(() => {});
  }
}

module.exports = { openerDue, messagesSince, key, absorb };

// Self-healing: if the browser closes or WhatsApp errors, wait and relaunch instead of dying.
if (require.main === module) (async () => {
  while (true) {
    try { await session(); }
    catch (e) { console.error(`Session error: ${e.message.split('\n')[0]}. Relaunching in 15s...`); log({ event: 'restart', error: e.message.split('\n')[0] }); }
    if (fs.existsSync('STOP')) { console.log('STOP file found, exiting.'); process.exit(0); }
    await sleep(15000);
  }
})();
