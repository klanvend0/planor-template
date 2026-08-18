/**
 * App icon builder.
 *
 * The icon is vector art defined here rather than a binary someone has to open a
 * design tool to change: run `npm run icon:build` and every variant iOS, Android
 * and the web need is rendered from the same source.
 *
 * Apple rules the output obeys:
 *  - 1024x1024, fully opaque, no alpha channel (an RGBA icon is rejected);
 *  - no rounded corners baked in — the system applies the mask;
 *  - separate light, dark and tinted variants (the tinted one is grayscale).
 *
 * Android's adaptive foreground and the splash logo keep their transparency and
 * sit inside the 66% safe zone so nothing is cropped.
 *
 * @module scripts/build_icons
 */

import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'assets', 'images');

type Palette = {
  /** Background fill; null renders the glyph on transparency. */
  background: string | null;
  glyphStart: string;
  glyphEnd: string;
  spark: string;
  cursor: string;
};

const PALETTES: Record<'light' | 'dark' | 'tinted' | 'transparent', Palette> = {
  // The default icon: the glyph reads as an editor prompt on ink.
  light: {
    background: '#141733',
    glyphStart: '#8B6BFF',
    glyphEnd: '#3ED0F0',
    spark: '#FFB74D',
    cursor: '#3ED0F0',
  },
  dark: {
    background: '#07080F',
    glyphStart: '#9E86FF',
    glyphEnd: '#5CDBF5',
    spark: '#FFC46B',
    cursor: '#5CDBF5',
  },
  // Apple tints the icon itself, so the artwork must be grayscale.
  tinted: {
    background: '#101010',
    glyphStart: '#F2F2F2',
    glyphEnd: '#BFBFBF',
    spark: '#8C8C8C',
    cursor: '#D9D9D9',
  },
  transparent: {
    background: null,
    glyphStart: '#8B6BFF',
    glyphEnd: '#3ED0F0',
    spark: '#FFB74D',
    cursor: '#3ED0F0',
  },
};

/**
 * The artwork: a chevron-and-cursor prompt (`>_`) with a spark.
 *
 * @param palette - Colours to draw with.
 * @param inset - Fraction of the canvas to keep clear around the glyph, used for
 * Android's adaptive foreground where the launcher may crop to a circle.
 */
function icon(palette: Palette, inset = 0): string {
  const size = 1024;
  const scale = 1 - inset;
  const translate = (size * inset) / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="glyph" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${palette.glyphStart}"/>
      <stop offset="1" stop-color="${palette.glyphEnd}"/>
    </linearGradient>
    <linearGradient id="bg" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="${palette.background ?? '#000000'}"/>
      <stop offset="1" stop-color="${palette.background ?? '#000000'}" stop-opacity="0.86"/>
    </linearGradient>
  </defs>

  ${palette.background ? `<rect width="${size}" height="${size}" fill="url(#bg)"/>` : ''}

  <g transform="translate(${translate} ${translate}) scale(${scale})">
    <!-- chevron: the prompt -->
    <path d="M300 336 L470 512 L300 688"
          fill="none"
          stroke="url(#glyph)"
          stroke-width="86"
          stroke-linecap="round"
          stroke-linejoin="round"/>

    <!-- cursor: the underscore waiting for input -->
    <rect x="536" y="628" width="220" height="72" rx="36" fill="${palette.cursor}"/>

    <!-- spark: the moment something clicks -->
    <path d="M672 300 L697 366 L763 391 L697 416 L672 482 L647 416 L581 391 L647 366 Z"
          fill="${palette.spark}"/>
  </g>
</svg>`;
}

/** CRC-32, as PNG chunks require. */
function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * Encode RGBA pixels as a truecolour PNG **without** an alpha channel.
 *
 * App Store Connect rejects an icon that carries one at all (ITMS-90717), even
 * when every pixel is fully opaque, and every rasteriser here emits RGBA — so
 * the alpha byte is dropped while writing.
 */
function encodeOpaquePng(pixels: Buffer, width: number, height: number): Buffer {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type: none
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4;
      const target = y * (stride + 1) + 1 + x * 3;
      raw[target] = pixels[source];
      raw[target + 1] = pixels[source + 1];
      raw[target + 2] = pixels[source + 2];
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour, no alpha
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Render an SVG to PNG.
 *
 * @param opaque - Strip the alpha channel, for icons Apple will inspect.
 */
function render(svg: string, width: number, opaque: boolean): Buffer {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: width } });
  const image = resvg.render();
  return opaque
    ? encodeOpaquePng(Buffer.from(image.pixels), image.width, image.height)
    : Buffer.from(image.asPng());
}

const OUTPUTS: { file: string; svg: string; width: number; opaque: boolean }[] = [
  { file: 'icon.png', svg: icon(PALETTES.light), width: 1024, opaque: true },
  { file: 'icon-dark.png', svg: icon(PALETTES.dark), width: 1024, opaque: true },
  { file: 'icon-tinted.png', svg: icon(PALETTES.tinted), width: 1024, opaque: true },
  // Android draws its own background colour behind this foreground.
  { file: 'adaptive-icon.png', svg: icon(PALETTES.transparent, 0.32), width: 1024, opaque: false },
  { file: 'splash-icon.png', svg: icon(PALETTES.transparent, 0.12), width: 512, opaque: false },
  { file: 'favicon.png', svg: icon(PALETTES.light), width: 96, opaque: true },
];

function main(): void {
  for (const output of OUTPUTS) {
    const png = render(output.svg, output.width, output.opaque);
    writeFileSync(join(OUT, output.file), png);
    console.log(`${output.file}  ${output.width}px  ${(png.length / 1024).toFixed(1)}KB`);
  }
  console.log(`\nWrote ${OUTPUTS.length} icons to assets/images.`);
}

main();
