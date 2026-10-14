const { firefox } = require('playwright');
const { at } = require('./config');

// The WhatsApp Web session lives in ./profile of the user's wingmate folder.
async function openBrowser() {
  const context = await firefox.launchPersistentContext(at('profile'), { headless: false, viewport: null });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto('https://web.whatsapp.com');
  return { context, page };
}

// First run: show WhatsApp Web so the user can scan the QR code. Resolves when they close the window.
async function login() {
  const { context } = await openBrowser();
  console.log('WhatsApp Web is open. Scan the QR code, wait for your chats to load, then close the window.');
  await new Promise((r) => context.on('close', r));
}

async function launch() {
  const { context, page } = await openBrowser();
  await page.waitForSelector('#pane-side', { timeout: 0 }); // chat list = logged in
  await page.locator('#side input[aria-label="Search or start a new chat"]').waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(4000); // let WhatsApp finish its initial sync before we interact
  return { context, page };
}

async function openChat(page, contact) {
  const inList = page.locator(`#pane-side span[title="${contact}"]`).first();
  for (let attempt = 1; ; attempt++) {
    try {
      if (await page.locator(`#main header span[title="${contact}"]`).count()) return; // already open
      // Prefer the chat list: search results keep re-rendering, which made clicks time out.
      if (!(await inList.count())) {
        await page.locator('#side input[type="text"]').first().fill(contact, { timeout: 15000 });
        await inList.waitFor({ state: 'attached', timeout: 15000 });
      }
      await inList.click({ timeout: 10000, force: true }); // force: don't wait for the list to stop moving
      await page.waitForSelector('#main footer', { timeout: 15000 });
      return;
    } catch (e) {
      if (attempt >= 4) throw e;
      await page.reload(); // also clears a half-typed search
      await page.waitForSelector('#pane-side', { timeout: 60000 });
      await page.waitForTimeout(4000);
    }
  }
}

// Returns [{ dir: 'in'|'out', time, text, reaction }] for currently loaded messages, oldest first.
async function readMessages(page, contact) {
  return page.$$eval('#main div[role="row"]', (rows, contact) =>
    rows.flatMap((row) => {
      const box = row.querySelector('div.copyable-text[data-pre-plain-text]');
      if (!box) return [];
      // emoji are <img alt="..."> and line breaks are <br>, so walk the nodes instead of using innerText
      const textOf = (n) => [...n.childNodes].map((c) =>
        c.nodeType === 3 ? c.textContent : c.tagName === 'IMG' ? c.alt : c.tagName === 'BR' ? '\n' : textOf(c)).join('');
      const spans = [...box.querySelectorAll('span.selectable-text')]; // quoted-reply text comes first; the message itself is last
      const text = spans.length ? textOf(spans[spans.length - 1]).trim() : '';
      if (!text) return [];
      const rx = row.querySelector('[aria-label^="reaction "]'); // e.g. "reaction ❤️. View reactions"
      const reaction = rx ? (rx.getAttribute('aria-label').match(/^reaction\s+(.+?)\.\s*View/) || [])[1] || null : null;
      return [{
        reaction,
        dir: box.getAttribute('data-pre-plain-text').trim().endsWith(`] ${contact}:`) ? 'in' : 'out',
        time: box.getAttribute('data-pre-plain-text'), // "[10:32 am, 31/12/2026] Name: "
        text,
      }];
    }), contact
  );
}

async function scrollUp(page) {
  await page.evaluate(() => {
    const scrollers = [...document.querySelectorAll('#main *')].filter(
      (e) => e.scrollHeight > e.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(e).overflowY)
    );
    scrollers.forEach((e) => (e.scrollTop = 400)); // nudge down so reaching the top fires a fresh scroll event
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    [...document.querySelectorAll('#main *')]
      .filter((e) => e.scrollHeight > e.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(e).overflowY))
      .forEach((e) => (e.scrollTop = 0));
  });
}

async function send(page, text) {
  const box = page.locator('footer div[contenteditable="true"]').first();
  await box.click();
  await box.pressSequentially(text, { delay: 60 + Math.random() * 60 });
  await page.keyboard.press('Enter');
}

const composer = (page) => page.locator('footer div[contenteditable="true"]').first();

async function composerText(page) {
  return (await composer(page).innerText()).trim();
}

// Types the draft into the message box WITHOUT sending. Lines are joined with Shift+Enter.
async function prefill(page, lines) {
  await composer(page).focus(); // focus, not click: a click waits for the box to be unobstructed and timed out mid-chat
  for (let i = 0; i < lines.length; i++) {
    if (i) await page.keyboard.press('Shift+Enter');
    await page.keyboard.type(lines[i], { delay: 12 });
  }
}

async function clearComposer(page) {
  await composer(page).focus();
  await page.keyboard.press('Meta+A');
  await page.keyboard.press('Backspace');
}

module.exports = { login, launch, openChat, readMessages, scrollUp, send, composerText, prefill, clearComposer };
