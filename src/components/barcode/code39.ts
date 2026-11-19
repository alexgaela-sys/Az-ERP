// Code 39 ("3 of 9") barcode encoder — pure data, no dependency.
//
// Why Code 39 and not Code 128: Code 39 only needs digits, uppercase letters
// and a handful of symbols (exactly what item codes like "SNK-001" use), and
// its character table is small and simple enough to keep correct by hand —
// no risk of a subtly-wrong lookup table producing an unscannable code.
// It is readable by essentially every barcode scanner on the market.
//
// Each character's pattern is 9 widths (5 bars + 4 spaces, starting and
// ending on a bar): '0' = narrow, '1' = wide. Every valid character has
// exactly three wide elements ("3 of 9").

const CODE39_PATTERNS: Record<string, string> = {
  '0': '000110100', '1': '100100001', '2': '001100001', '3': '101100000',
  '4': '000110001', '5': '100110000', '6': '001110000', '7': '000100101',
  '8': '100100100', '9': '001100100',
  A: '100001001', B: '001001001', C: '101001000', D: '000011001',
  E: '100011000', F: '001011000', G: '000001101', H: '100001100',
  I: '001001100', J: '000011100', K: '100000011', L: '001000011',
  M: '101000010', N: '000010011', O: '100010010', P: '001010010',
  Q: '000000111', R: '100000110', S: '001000110', T: '000010110',
  U: '110000001', V: '011000001', W: '111000000', X: '010010001',
  Y: '110010000', Z: '011010000',
  '-': '010000101', '.': '110000100', ' ': '011000100', $: '010101000',
  '/': '010100010', '+': '010001010', '%': '000101010',
  '*': '010010100', // start/stop
};

/** Upper-cases and replaces any character Code 39 can't encode with '-'. */
export function sanitizeCode39(text: string): string {
  return text
    .toUpperCase()
    .split('')
    .map(ch => (CODE39_PATTERNS[ch] ? ch : '-'))
    .join('');
}

/**
 * Builds the sequence of [isBar, widthUnits] elements for `*TEXT*`,
 * including the inter-character gap (one narrow space) after every
 * character except the last.
 */
export function code39Elements(text: string): Array<{ bar: boolean; wide: boolean }> {
  const body = `*${sanitizeCode39(text)}*`;
  const elements: Array<{ bar: boolean; wide: boolean }> = [];
  for (let c = 0; c < body.length; c++) {
    const pattern = CODE39_PATTERNS[body[c]] ?? CODE39_PATTERNS['-'];
    for (let i = 0; i < 9; i++) {
      elements.push({ bar: i % 2 === 0, wide: pattern[i] === '1' });
    }
    if (c < body.length - 1) {
      elements.push({ bar: false, wide: false }); // inter-character gap: narrow space
    }
  }
  return elements;
}

export interface BarcodeSvgOptions {
  narrow?: number; // px
  wideRatio?: number; // wide = narrow * wideRatio
  height?: number; // px, bar height
  quietZone?: number; // px on each side
  showText?: boolean;
}

/** Renders a standalone Code 39 barcode as an SVG markup string. */
export function code39Svg(text: string, opts: BarcodeSvgOptions = {}): string {
  const narrow = opts.narrow ?? 2;
  const wide = narrow * (opts.wideRatio ?? 2.5);
  const height = opts.height ?? 50;
  const quiet = opts.quietZone ?? narrow * 10;
  const showText = opts.showText ?? true;

  const elements = code39Elements(text);
  let x = quiet;
  const bars: string[] = [];
  for (const el of elements) {
    const w = el.wide ? wide : narrow;
    if (el.bar) bars.push(`<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${height}" fill="#000"/>`);
    x += w;
  }
  const totalWidth = x + quiet;
  const textY = height + 14;
  const label = sanitizeCode39(text);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth.toFixed(2)}" height="${showText ? height + 18 : height}" ` +
    `viewBox="0 0 ${totalWidth.toFixed(2)} ${showText ? height + 18 : height}">` +
    `<rect x="0" y="0" width="${totalWidth.toFixed(2)}" height="${showText ? height + 18 : height}" fill="#fff"/>` +
    bars.join('') +
    (showText
      ? `<text x="${(totalWidth / 2).toFixed(2)}" y="${textY}" text-anchor="middle" font-family="monospace" font-size="11" fill="#000">${label}</text>`
      : '') +
    `</svg>`
  );
}
