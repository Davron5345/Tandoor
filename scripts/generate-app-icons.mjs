import sharp from 'sharp';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const src = join(root, 'client/resources/mahalla-icon.png');

const androidSizes = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

async function makeSquareIcon(size, outPath) {
  await sharp(src)
    .resize(size, size, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toFile(outPath);
}

for (const [folder, size] of Object.entries(androidSizes)) {
  const dir = join(root, 'android/app/src/main/res', folder);
  mkdirSync(dir, { recursive: true });
  await makeSquareIcon(size, join(dir, 'ic_launcher.png'));
  await makeSquareIcon(size, join(dir, 'ic_launcher_round.png'));
  await makeSquareIcon(size, join(dir, 'ic_launcher_foreground.png'));
}

const iconsDir = join(root, 'client/public/icons');
mkdirSync(iconsDir, { recursive: true });
await makeSquareIcon(192, join(iconsDir, 'icon-192.png'));
await makeSquareIcon(512, join(iconsDir, 'icon-512.png'));

console.log('Icons generated from mahalla-icon.png');
