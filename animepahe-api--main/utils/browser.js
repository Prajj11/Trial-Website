const firefox = require('playwright').firefox;
const path = require('path');
const os = require('os');

async function launchBrowser() {
    const firefoxPath = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright', 'firefox-1482', 'firefox', 'firefox.exe');
    
    const launchOptions = {
        headless: true,
        args: [],
        executablePath: firefoxPath
    };

    console.log('Using Firefox for Playwright at:', firefoxPath);
    return await firefox.launch(launchOptions);
}

module.exports = { launchBrowser };
