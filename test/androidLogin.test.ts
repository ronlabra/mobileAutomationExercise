import { test } from "@playwright/test";

const { _android: android } = require('playwright');

test("Run in Android - Chrome", async () => {
    // Connect to the device.
    const [device] = await android.devices();
    console.log(`Model: ${device.model()}`);
    console.log(`Serial: ${device.serial()}`);
    // Take screenshot of the device.
    await device.screenshot({ path: 'device.png' });

    // // Launch Chrome browser.
    await device.shell('am force-stop com.android.chrome');
    const context = await device.launchBrowser();

    // // Use BrowserContext as usual.
    const page = await context.newPage();
    await page.goto('http://admin-staging.aonewallet.com'); //Wallet Back-Office staging
    console.log(await page.evaluate(() => window.location.href));
    await page.screenshot({ path: 'page.png' });

    // // Click input[name="email"]
    await page.click('input[name="username"]');
    // // Fill input[name="email"]
    await page.fill('input[name="username"]', 'admin88');
    // // Press Tab
    await page.press('input[name="username"]', 'Tab');
    // // Fill input[name="password"]
    await page.fill('input[name="password"]', 'password');

    await Promise.all([
        page.waitForNavigation({ url: 'http://admin-staging.aonewallet.com' }),
        page.click(`//button[@type='submit']`)
    ]);


});