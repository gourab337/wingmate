const fs = require('fs');
const { launch, openChat, readMessages, scrollUp } = require('./wa');
const { cfg: { contact } } = require('./config');

const key = (m) => `${m.time}|${m.dir}|${m.text}`;

async function scrape() {
  const { context, page } = await launch();
  fs.mkdirSync('data', { recursive: true });
  await openChat(page, contact);
  await page.waitForTimeout(4000);

  // WhatsApp virtualises the chat (~100 rows in DOM), so merge each snapshot as we scroll up.
  let all = await readMessages(page, contact);
  let idle = 0;
  for (let i = 0; i < 150 && idle < 16; i++) {
    await scrollUp(page);
    await page.waitForTimeout(4000);
    const snap = await readMessages(page, contact);
    const seen = new Set(all.map(key));
    const k = snap.findIndex((m) => seen.has(key(m)));
    const fresh = (k === -1 ? snap : snap.slice(0, k)).filter((m) => !seen.has(key(m)));
    if (fresh.length) { all = [...fresh, ...all]; idle = 0; } else idle++;
    if (i % 10 === 0) console.log(`scroll ${i}: ${all.length} messages`);
  }

  const old = fs.existsSync('data/history.json') ? JSON.parse(fs.readFileSync('data/history.json')).length : 0;
  if (all.length < old * 0.9) {
    fs.writeFileSync('data/history.partial.json', JSON.stringify(all, null, 2));
    console.log(`Only got ${all.length} messages (have ${old}); kept the existing file. Partial saved to data/history.partial.json. Re-run.`);
  } else {
    fs.writeFileSync('data/history.json', JSON.stringify(all, null, 2));
    console.log(`Saved ${all.length} messages to data/history.json`);
  }
  await context.close();
}

module.exports = { scrape };
