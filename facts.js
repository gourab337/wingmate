// Builds data/facts.md from the full chat: a memory profile of both of them, so replies can connect dots
// and never contradict what was said.
const fs = require('fs');
const path = require('path');
const { run, transcriptOf } = require('./reply');
const { me: ME, them: THEM } = require('./config.json').names;

const SYSTEM = (today) => `You build a memory profile from a WhatsApp chat between ${ME} and ${THEM}, so later replies can connect dots and never contradict what was said. Every chat line is timestamped (dd/mm/yyyy). Today is ${today}. Output markdown with exactly three sections.

## What ${ME} has told her about himself
One short bullet per fact that ${ME.toUpperCase()} HIMSELF stated: home city, where he lives now, studies, work, shows/films/books/music/food he has seen or likes or dislikes, habits, hobbies, experiences, opinions.

## What ${THEM} has said she likes or dislikes
One short bullet per NON-SENSITIVE preference or interest ${THEM.toUpperCase()} stated: shows, food, places, hobbies, routines, dislikes.

## Shared history and open threads
Things they did together, running jokes or nicknames, and plans or promises either made. Give the date for anything time-bound. If its date is before today, write it as something that already happened; only call it a plan if it is still in the future.

Rules:
- Only what is explicitly written by that person. No inference: a reaction like "that's scary" or a passing comparison is not a fact about them.
- Keep bullets faithful to the wording, with specifics (titles, places, seasons). Do not add details that were not said.
- EXCLUDE completely: health, doctors or medical matters; her study or work problems; dating history, exes, past matches, who either person is attracted to, or why they joined a dating app; deaths or grief; family problems; one-off trivia like what someone ate on a given day.
- If something was a joke, sarcasm, or unclear, leave it out.`;

async function refreshFacts() {
  const h = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/history.json'), 'utf8'));
  const today = new Date().toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const out = await run(SYSTEM(today), transcriptOf(h));
  fs.writeFileSync(path.join(__dirname, 'data/facts.md'), out + '\n');
  return h.length;
}

module.exports = { refreshFacts };

if (require.main === module) refreshFacts().then((n) => console.log(`facts.md built from ${n} messages`));
