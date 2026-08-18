/**
 * App icon builder — "The Indent".
 *
 * The mark is two phosphor code lines stepping right with a cursor waiting at
 * the end of the second: indentation is Python's syntax, the staircase reads as
 * progress, and the cursor says "your turn". Deliberately not a `>_` terminal
 * prompt, which is the most crowded mark in the developer category.
 *
 * The icon is vector art defined here rather than a binary someone has to open a
 * design tool to change: run `npm run icon:build` and every variant iOS, Android
 * and the web need is rendered from the same geometry.
 *
 * Apple rules the output obeys:
 *  - 1024x1024, fully opaque, no alpha channel (an RGBA icon is rejected);
 *  - no rounded corners baked in — the system applies the squircle;
 *  - separate light, dark and tinted variants (the tinted one is grayscale).
 *
 * The mark's optical centre is exactly (512, 512) and its furthest corner sits
 * 266px out, so it survives every mask — squircle, circle, or watch.
 *
 * @module scripts/build_icons
 */

import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'assets', 'images');

type Variant = {
  /** Cabinet gradient stops; null renders the mark on transparency. */
  ground: [string, string] | null;
  /** Screen bezel, dropped on the flat variants. */
  bezel: { fill: string; outer: string; inner: string } | null;
  bar: string;
  caret: string;
  /** Phosphor bloom behind the mark. */
  glow: boolean;
  /** CRT scanlines and registration marks. */
  detail: boolean;
  /** Scale applied to the mark, for masks that crop (Android adaptive). */
  scale: number;
};

const VARIANTS: Record<string, Variant> = {
  // The default icon: lit screen in a machined cabinet.
  primary: {
    ground: ['#0E1A21', '#060F14'],
    bezel: { fill: '#070E12', outer: '#426F80', inner: '#0E2730' },
    bar: '#22F1A5',
    caret: '#2FD7F9',
    glow: true,
    detail: true,
    scale: 1,
  },
  // iOS dark variant: same geometry, flattened ground, no bloom.
  dark: {
    ground: ['#0B141A', '#0B141A'],
    bezel: { fill: '#070E12', outer: '#2C4C59', inner: '#0E2730' },
    bar: '#FFFFFF',
    caret: '#FFFFFF',
    glow: false,
    detail: false,
    scale: 1,
  },
  // iOS tinted: Apple applies the colour, so the artwork is grayscale.
  tinted: {
    ground: ['#101010', '#101010'],
    bezel: { fill: '#0A0A0A', outer: '#5A5A5A', inner: '#1C1C1C' },
    bar: '#FFFFFF',
    caret: '#D6D6D6',
    glow: false,
    detail: false,
    scale: 1,
  },
  // Android adaptive foreground: the launcher supplies the background.
  adaptive: {
    ground: null,
    bezel: null,
    bar: '#22F1A5',
    caret: '#2FD7F9',
    glow: true,
    detail: false,
    scale: 0.62,
  },
  // Splash: the mark alone, over the plugin's background colour.
  splash: {
    ground: null,
    bezel: null,
    bar: '#22F1A5',
    caret: '#2FD7F9',
    glow: false,
    detail: false,
    scale: 0.78,
  },
};

const SIZE = 1024;

/**
 * Draw the icon.
 *
 * Coordinates come straight from the design spec, so the layers stay readable
 * against it: ground, bezel, glow, mark, CRT detail.
 */
function icon(variant: Variant): string {
  const { scale } = variant;
  const translate = (SIZE * (1 - scale)) / 2;

  // Phosphor bloom: the mark itself, blurred and dimmed underneath the crisp
  // copy. A real blur rather than stacked rectangles, which read as boxes.
  const glow = variant.glow
    ? `
    <g filter="url(#bloom)" opacity="0.55">
      <rect x="276" y="390" width="440" height="96" rx="12" fill="${variant.bar}"/>
      <rect x="368" y="526" width="252" height="96" rx="12" fill="${variant.bar}"/>
      <rect x="644" y="514" width="104" height="120" rx="8" fill="${variant.caret}"/>
    </g>`
    : '';

  const bezel = variant.bezel
    ? `
  <rect x="176" y="176" width="672" height="672" rx="104" fill="${variant.bezel.fill}"
        stroke="${variant.bezel.outer}" stroke-width="10"/>
  <rect x="190" y="190" width="644" height="644" rx="92" fill="none"
        stroke="${variant.bezel.inner}" stroke-width="3"/>`
    : '';

  const detail = variant.detail
    ? `
  <rect x="200" y="286" width="624" height="18" fill="#FFFFFF" opacity="0.025"/>
  <rect x="200" y="712" width="624" height="18" fill="#FFFFFF" opacity="0.025"/>
  <rect x="242" y="242" width="20" height="20" fill="${variant.caret}" opacity="0.55"/>
  <rect x="762" y="242" width="20" height="20" fill="${variant.caret}" opacity="0.55"/>
  <rect x="242" y="762" width="20" height="20" fill="${variant.caret}" opacity="0.55"/>
  <rect x="762" y="762" width="20" height="20" fill="${variant.caret}" opacity="0.55"/>`
    : '';

  const ground = variant.ground
    ? `<rect width="${SIZE}" height="${SIZE}" fill="url(#cabinet)"/>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <linearGradient id="cabinet" x1="512" y1="0" x2="512" y2="${SIZE}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${variant.ground?.[0] ?? '#000000'}"/>
      <stop offset="1" stop-color="${variant.ground?.[1] ?? '#000000'}"/>
    </linearGradient>
    <filter id="bloom" x="-25%" y="-25%" width="150%" height="150%">
      <feGaussianBlur stdDeviation="26"/>
    </filter>
  </defs>

  ${ground}${bezel}

  <g transform="translate(${translate} ${translate}) scale(${scale})">
    ${glow}
    <!-- the whitespace the second line is indented by -->
    <rect x="310" y="526" width="8" height="96" fill="${variant.bar}" opacity="0.22"/>
    <!-- line one -->
    <rect x="276" y="390" width="440" height="96" rx="12" fill="${variant.bar}"/>
    <!-- line two, indented -->
    <rect x="368" y="526" width="252" height="96" rx="12" fill="${variant.bar}"/>
    <!-- the cursor, waiting -->
    <rect x="644" y="514" width="104" height="120" rx="8" fill="${variant.caret}"/>
  </g>
  ${detail}
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
 * when every pixel is fully opaque, and the rasteriser always emits RGBA — so
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
 * @param opaque - Strip the alpha channel, for the icons Apple inspects.
 */
function render(svg: string, width: number, opaque: boolean): Buffer {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: width } });
  const image = resvg.render();
  return opaque
    ? encodeOpaquePng(Buffer.from(image.pixels), image.width, image.height)
    : Buffer.from(image.asPng());
}

const OUTPUTS: { file: string; variant: Variant; width: number; opaque: boolean }[] = [
  { file: 'icon.png', variant: VARIANTS.primary, width: 1024, opaque: true },
  { file: 'icon-dark.png', variant: VARIANTS.dark, width: 1024, opaque: true },
  { file: 'icon-tinted.png', variant: VARIANTS.tinted, width: 1024, opaque: true },
  { file: 'adaptive-icon.png', variant: VARIANTS.adaptive, width: 1024, opaque: false },
  { file: 'splash-icon.png', variant: VARIANTS.splash, width: 512, opaque: false },
  { file: 'favicon.png', variant: VARIANTS.primary, width: 96, opaque: true },
];

function main(): void {
  for (const output of OUTPUTS) {
    const png = render(icon(output.variant), output.width, output.opaque);
    writeFileSync(join(OUT, output.file), png);
    console.log(`${output.file}  ${output.width}px  ${(png.length / 1024).toFixed(1)}KB`);
  }
  console.log(`\nWrote ${OUTPUTS.length} icons to assets/images.`);
}

main();
