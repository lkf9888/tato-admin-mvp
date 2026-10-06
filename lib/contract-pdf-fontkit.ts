import * as fontkit from "fontkit";

/**
 * The fontkit pdf-lib gets handed, with a working subsetter.
 *
 * pdf-lib 1.17.1 ships `@pdf-lib/fontkit@1.1.1`, a fork of fontkit v1 whose
 * subsetter produces a structurally broken font for a CJK face — not merely a
 * wrong-looking one. fontTools cannot parse what it emits; Quick Look draws
 * Chinese as `! " # $ % & ' ( )` (the subset's glyph indices read as ASCII) and
 * pdf.js draws empty boxes while logging `getFontFileType: Unable to detect
 * correct font file Type/Subtype` and `Out of bounds subrIndex for callsubr`.
 * Two renderers, two different wrong answers, neither of them the document.
 *
 * Since this product's contracts are mostly in Chinese, that made every PDF it
 * generates unreadable — signed leases included.
 *
 * The maintained fontkit (v2) subsets the same text correctly. The only thing
 * in the way is that pdf-lib asks the subset for an `encodeStream()` while v2
 * returns the bytes from `encode()`, so that is all this adapts. Everything
 * else — parsing, layout, glyph lookup — is fontkit's own code either way.
 */
type Fontkit = Parameters<
  import("pdf-lib").PDFDocument["registerFontkit"]
>[0];

/**
 * pdf-lib consumes the subset as `.on('data').on('end').on('error')`, attaching
 * all three synchronously. A whole Node stream is more than that needs, and
 * pulling one into the serverless bundle for it would be the tail wagging the
 * dog — this is the same contract in nine lines.
 */
function bytesAsStream(bytes: Uint8Array) {
  const handlers = new Map<string, Array<(arg?: unknown) => void>>();
  const stream = {
    on(event: string, callback: (arg?: unknown) => void) {
      const list = handlers.get(event) ?? [];
      list.push(callback);
      handlers.set(event, list);
      return stream;
    },
  };
  // After the caller has finished attaching its listeners, never during.
  queueMicrotask(() => {
    for (const callback of handlers.get("data") ?? []) callback(bytes);
    for (const callback of handlers.get("end") ?? []) callback();
  });
  return stream;
}

export const pdfLibFontkit = {
  create(input: Uint8Array) {
    const font = fontkit.create(
      Buffer.isBuffer(input) ? input : Buffer.from(input),
    ) as unknown as {
      createSubset: () => { encode: () => Uint8Array; encodeStream?: unknown };
    };
    const createSubset = font.createSubset.bind(font);
    font.createSubset = () => {
      const subset = createSubset();
      subset.encodeStream = () => bytesAsStream(subset.encode());
      return subset;
    };
    return font;
  },
} as unknown as Fontkit;
