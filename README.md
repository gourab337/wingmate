# wingmate

**Drafts WhatsApp replies to the person you're dating, in your own voice. You read every draft and press Enter yourself.**

wingmate watches one WhatsApp Web chat. When they text you, it writes a reply that sounds like you (learned from
your real chat history) and types it into the message box. It never presses Enter. Delete the draft and it tries a
different angle; send it, edit it, or ignore it.

It's built to help you stay responsive and sound like yourself, not to replace you:

- **Your voice, measured.** Drafts are grounded in your past replies and in stats from your own messages (length,
  punctuation, how often you ask questions), so they don't read like an AI.
- **No invented facts.** A second pass checks every draft. Places, plans or claims about your life that aren't in the
  chat or your notes get the draft rejected and rewritten.
- **Knows when to hand over.** Anything serious, emotional, about commitment, about your real plans, or about a photo
  it can't see becomes `ESCALATE`: you get a desktop notification instead of a draft.
- **Remembers.** `data/facts.md` keeps track of what each of you has said, so drafts can call back to earlier messages
  and never contradict them. Sensitive topics (health, family, exes, grief) are deliberately left out.
- **Paced like a person.** It waits until they've stopped sending, mirrors who usually starts conversations, and can suggest
  an opener after a long silence (as a draft, never sent).

## Before you use it

- **WhatsApp's Terms of Service do not allow automated or unofficial clients.** wingmate drives WhatsApp Web in a
  real browser and only types drafts, but WhatsApp can still restrict or ban accounts it thinks are automated. Use it
  at your own risk.
- **Their messages are sent to an AI provider.** Your chat history and their new messages go to Anthropic through
  the `claude` CLI to write each draft. They haven't agreed to that. Depending on where you live (for example under
  the EU's GDPR) you may be responsible for that choice.
- **It's a drafting aid, not a stand-in for you.** The default prompts forbid manipulation, guilt-tripping,
  pressure, fake stories and using anything sensitive they've shared. Keep it that way.

## Requirements

- Node.js 18+
- [Claude Code](https://claude.com/claude-code), installed and logged in (a Claude subscription or an Anthropic API
  key). wingmate calls `claude -p` for every draft.
- macOS or Linux (Windows is untested). Desktop notifications use macOS notifications or `notify-send` on Linux.

## Quick start

```bash
npm install -g github:gourab337/wingmate   # also downloads the Firefox build Playwright uses

mkdir ~/wingmate && cd ~/wingmate          # your private folder: config, prompts, chat data
wingmate init                              # creates config.json, CLAUDE.md, style.md, rules.md, data/
```

Fill in `config.json` and the `<placeholders>` in the three `.md` files (see [Setup files](#setup-files)), then:

```bash
wingmate login     # WhatsApp Web opens: scan the QR code with your phone, wait for chats to load, close the window
wingmate scrape    # copies the chat history into data/history.json (a few minutes for long chats)
wingmate facts     # builds data/facts.md from the history
wingmate eval 10   # optional: drafts for your last 10 real exchanges, side by side with what you actually sent
wingmate start     # watch the chat and prefill drafts
```

To pause drafting, create a file named `PAUSE` in the folder (delete it to resume). Ctrl+C stops wingmate.

## Setup files

All of these live in your wingmate folder and stay on your machine.

| File | What it's for |
| --- | --- |
| `config.json` | Names, the WhatsApp contact, mode and timing. |
| `CLAUDE.md` | Who you are and how you want to come across: goals, voice, approved lines, a hard-no list, and a `## Known facts` section with the only facts about you a draft may state. Keep that heading. |
| `style.md` | How you text: length, punctuation, slang, emoji, phrases that aren't you. |
| `rules.md` | Reply rules. Keep the `MODE:` / `SKIP` / `ESCALATE:` format lines; wingmate parses them. |

Prompt files are re-read on every draft, so edits take effect without restarting. Tip: when a draft is good, add it
to "Approved lines" in `CLAUDE.md`. When one sounds wrong, add the phrase to `style.md` as something you'd never say.

### config.json

| Key | Meaning |
| --- | --- |
| `names.me`, `names.them` | First names used in the prompts. |
| `contact` | The chat name exactly as WhatsApp shows it. |
| `dateOrder` | `dmy` (31/12/2026) or `mdy` (12/31/2026), matching WhatsApp's dates. `init` guesses from your system locale. |
| `mode` | `prefill` types drafts into WhatsApp for you to send. `approve` shows each draft in the terminal; Enter sends it, `e` edits, `s` skips. |
| `model`, `checkModel` | Claude models for drafting and for the fact check. |
| `pollSeconds`, `debouncePolls` | How often to read the chat, and how many unchanged reads to wait so you answer a burst of messages once. |
| `replyDelaySeconds` | `approve` mode only: random delay before sending, so replies aren't instant. |
| `quietHours`, `maxSendsPerDay` | `approve` mode only: no sending in these hours, and a daily cap. |
| `initiate` | Suggest an opener after `silenceHours` of quiet, between `windowStart` and `windowEnd`, at most once a day. |

## What's in your folder

```
config.json  CLAUDE.md  style.md  rules.md   your setup
profile/        logged-in WhatsApp Web session. Treat it like a password: anyone with it can read your chats.
data/           history.json (the chat), facts.md, log.jsonl (every draft and what you sent), state
```

If you keep this folder in git, ignore `profile/`, `data/` and the four setup files. They contain names, private
messages and your session.

## How it works

1. `wa.js` drives WhatsApp Web with Playwright (Firefox) and reads messages, timestamps and reactions from the page.
2. When the other person stops typing, `reply.js` builds a prompt: your setup files, `facts.md`, stats about how you
   text, real past exchanges, and the recent chat with times.
3. `claude -p` writes a draft and labels it R (rapport), A (attraction) or N (neutral), so the mix of tones stays
   balanced. A second call fact-checks it.
4. `bot.js` types the draft into the box, notices whether you sent, edited or deleted it, and adds your real replies
   to the history so later drafts learn from them.

## License

ISC
