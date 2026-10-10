import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';

rmSync('dist-firefox', { recursive: true, force: true });
mkdirSync('dist-firefox');
cpSync('src', 'dist-firefox/src', { recursive: true });
cpSync('icons', 'dist-firefox/icons', { recursive: true });
cpSync('_locales', 'dist-firefox/_locales', { recursive: true });

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));

// Adapt manifest for Firefox Gecko MV3
manifest.browser_specific_settings = {
  gecko: {
    id: "codesnap-otp@fundingbotsecret.pp.ua",
    strict_min_version: "109.0"
  }
};

// Firefox MV3 uses background.scripts array
manifest.background = {
  scripts: ["src/background.js"],
  type: "module"
};

// Remove Chrome-only permissions for Firefox if present
manifest.permissions = manifest.permissions.filter(p => p !== 'offscreen');

writeFileSync('dist-firefox/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log('Built dist-firefox/. Manifest adapted with Gecko ID and background scripts.');
