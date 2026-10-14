const { firefox } = require('playwright');
const path = require('path');

(async () => {
  const context = await firefox.launchPersistentContext(path.join(__dirname, 'profile'), {
    headless: false,
    viewport: null,
  });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto('https://web.whatsapp.com');
  console.log('WhatsApp Web open. Scan the QR code on first run; the session persists in ./profile.');
  context.on('close', () => process.exit(0));
})();
