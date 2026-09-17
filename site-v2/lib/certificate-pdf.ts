import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

/*
 * The certificate PDF.
 *
 * spec/03: "PDF uses stored learner/program/version/issuer/completion
 * snapshots, UTC issue date and verification route. Bundle a licensed font
 * supporting the actual learner names, including accented characters; do not
 * silently replace unsupported characters."
 *
 * Both halves of that last sentence matter. The fonts are bundled under
 * assets/fonts (Lora and Nunito Sans, SIL Open Font License 1.1, the same
 * faces the site uses) rather than fetched, so a certificate renders the same
 * in ten years as today and does not depend on a CDN. And a name whose letters
 * the font cannot draw raises rather than rendering a row of empty boxes —
 * somebody named Ó Súilleabháin must not receive a certificate reading
 * "□ S□illeabh□in".
 */

export class CertificateFontError extends Error {
  constructor(readonly missing: string[]) {
    super(
      `The bundled font cannot render: ${missing.join(" ")}. The certificate was not produced.`
    );
    this.name = "CertificateFontError";
  }
}

export interface CertificateData {
  id: string;
  learner_name: string;
  program_title: string;
  version_number: number;
  issuer: string;
  completed_at: string;
  issued_at: string;
}

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");

/** UTC, spelled out. The issue date is a fact, not a local convenience. */
function utcDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}

/*
 * Every code point that must be drawable, checked before anything is written.
 * pdf-lib would otherwise substitute .notdef and produce a plausible-looking
 * document with the learner's name wrong in it — which is precisely what
 * "do not silently replace unsupported characters" forbids.
 *
 * fontkit reads the font's own character map, so this is the font's answer
 * rather than a guess about which scripts it covers.
 */
interface GlyphSource {
  hasGlyphForCodePoint(codePoint: number): boolean;
}

function assertRenderable(font: GlyphSource, texts: string[]): void {
  const missing = new Set<string>();
  for (const text of texts) {
    for (const character of text) {
      const codePoint = character.codePointAt(0);
      if (codePoint === undefined || character === "\n") continue;
      if (!font.hasGlyphForCodePoint(codePoint)) missing.add(character);
    }
  }
  if (missing.size > 0) throw new CertificateFontError([...missing]);
}

export async function renderCertificatePdf(
  certificate: CertificateData,
  verificationUrl: string
): Promise<Uint8Array> {
  const [display, body] = await Promise.all([
    readFile(path.join(FONT_DIR, "Lora-Variable.ttf")),
    readFile(path.join(FONT_DIR, "NunitoSans-Variable.ttf")),
  ]);

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const serif = await pdf.embedFont(display, { subset: true });
  const sans = await pdf.embedFont(body, { subset: true });
  // The same bytes, read by fontkit directly, to ask what each face covers.
  const serifGlyphs = fontkit.create(display) as unknown as GlyphSource;
  const sansGlyphs = fontkit.create(body) as unknown as GlyphSource;

  const lines = {
    heading: "Certificate of completion",
    intro: "This certifies that",
    name: certificate.learner_name,
    middle: "completed the course",
    title: certificate.program_title,
    version: `Version ${certificate.version_number}`,
    completed: `Completed on ${utcDate(certificate.completed_at)} (UTC)`,
    issued: `Issued on ${utcDate(certificate.issued_at)} (UTC) by ${certificate.issuer}`,
    verify: `Verify at ${verificationUrl}`,
  };

  assertRenderable(serifGlyphs, [lines.heading, lines.name, lines.title]);
  assertRenderable(sansGlyphs, [
    lines.intro, lines.middle, lines.version, lines.completed, lines.issued, lines.verify,
  ]);

  // A4 landscape, in points.
  const page = pdf.addPage([841.89, 595.28]);
  const { width, height } = page.getSize();
  const ink = rgb(0.11, 0.13, 0.17);
  const steel = rgb(0.42, 0.46, 0.53);
  const brand = rgb(0.15, 0.39, 0.64);

  page.drawRectangle({
    x: 28, y: 28, width: width - 56, height: height - 56,
    borderColor: brand, borderWidth: 1.5,
  });

  const centre = (text: string, font: PDFFont, size: number, y: number, color = ink) => {
    const textWidth = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (width - textWidth) / 2, y, size, font, color });
  };

  centre(lines.heading, serif, 30, height - 130, brand);
  centre(lines.intro, sans, 13, height - 190, steel);
  centre(lines.name, serif, 40, height - 250);
  centre(lines.middle, sans, 13, height - 295, steel);

  /*
   * A long programme title is shrunk to fit rather than clipped or wrapped
   * mid-word. Titles are at most 160 characters by the schema, so one line at
   * a reduced size always fits.
   */
  let titleSize = 26;
  while (serif.widthOfTextAtSize(lines.title, titleSize) > width - 160 && titleSize > 10) {
    titleSize -= 1;
  }
  centre(lines.title, serif, titleSize, height - 345);
  centre(lines.version, sans, 12, height - 375, steel);

  centre(lines.completed, sans, 12, 175);
  centre(lines.issued, sans, 12, 155, steel);
  centre(lines.verify, sans, 10, 110, steel);
  // The UUID is the verification identity (spec/03), so it is printed in full.
  centre(certificate.id, sans, 10, 92, steel);

  pdf.setTitle(`${lines.heading} — ${certificate.program_title}`);
  pdf.setAuthor(certificate.issuer);
  pdf.setSubject(`Certificate ${certificate.id}`);
  pdf.setProducer("PGLearn");
  pdf.setCreationDate(new Date(certificate.issued_at));
  pdf.setModificationDate(new Date(certificate.issued_at));

  return pdf.save();
}
