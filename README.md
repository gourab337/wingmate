# wa-agent

Drafts WhatsApp replies through WhatsApp Web (Playwright + Firefox) and the `claude` CLI. It only prefills the
message box; a human reads every draft and presses Enter.

## Setup

```bash
npm install
cp config.example.json config.json   # set names and the WhatsApp contact
cp CLAUDE.example.md CLAUDE.md       # goals, voice, Known facts (fill in the <placeholders>)
cp style.example.md style.md         # how you text
cp rules.example.md rules.md         # reply rules; keep the MODE/SKIP/ESCALATE format lines
node open.js                         # scan the QR code once; the session is kept in ./profile
node scrape-history.js               # pulls the chat into data/history.json
node facts.js                        # builds data/facts.md
node bot.js
```

`config.json`, `CLAUDE.md`, `style.md` and `rules.md` are personal and git-ignored; only the `*.example.*` templates
are committed. `reply.js` reads the `## Known facts` section of `CLAUDE.md`, so keep that heading.

`profile/` (logged-in WhatsApp session) and `data/` (chat history, logs) are git-ignored and must never be committed.
