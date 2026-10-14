# wa-agent

Drafts WhatsApp replies through WhatsApp Web (Playwright + Firefox) and the `claude` CLI. It only prefills the
message box; a human reads every draft and presses Enter.

## Setup

```bash
npm install
cp config.example.json config.json   # set names and the WhatsApp contact
node open.js                         # scan the QR code once; the session is kept in ./profile
node scrape-history.js               # pulls the chat into data/history.json
node facts.js                        # builds data/facts.md
node bot.js
```

The prompt files are personal and git-ignored, so create your own:

- `CLAUDE.md`: goals, voice and a `## Known facts` section (read by `reply.js`)
- `style.md`: how you text
- `rules.md`: reply rules and output format

`profile/` (logged-in WhatsApp session) and `data/` (chat history, logs) are git-ignored and must never be committed.
