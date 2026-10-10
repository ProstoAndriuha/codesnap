import { cpSync, mkdirSync, rmSync } from 'node:fs';
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
cpSync('manifest.json', 'dist/manifest.json');
cpSync('src', 'dist/src', { recursive: true });
cpSync('icons', 'dist/icons', { recursive: true });
cpSync('_locales', 'dist/_locales', { recursive: true });
console.log('Built dist/. The manifest public key pins the same extension ID for the source folder and release package.');
