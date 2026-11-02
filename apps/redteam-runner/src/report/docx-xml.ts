/**
 * Q-RP-2 — the OOXML primitives behind report/docx.ts: XML escaping,
 * paragraph/run builders, and the static package parts (content types,
 * relationships, styles). Text is data only — every caller-supplied
 * string passes through xesc, so target-derived text can never break
 * out of a text node. The styles are the document's own set (Title /
 * Heading1-3 / Normal / BrandLine), carrying the SecScan house brand:
 * the logo palette (diamond CF2B4D, crosshair 38BDF8, interior
 * 0B1120) and the display face on the title and headings.
 */

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

/** Escape a string for an XML text node (quotes included, so the same
 * helper is safe for attribute values too). */
export function xesc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export interface RunSeg {
  text: string
  bold?: boolean
  italic?: boolean
  /** OOXML hex colour (no '#'), e.g. 'CF2B4D'. */
  color?: string
}

function run(seg: RunSeg): string {
  const rpr = seg.bold || seg.italic || seg.color
    ? `<w:rPr>${seg.bold ? '<w:b/>' : ''}${seg.italic ? '<w:i/>' : ''}${seg.color ? `<w:color w:val="${seg.color}"/>` : ''}</w:rPr>`
    : ''
  return `<w:r>${rpr}<w:t xml:space="preserve">${xesc(seg.text)}</w:t></w:r>`
}

/** One paragraph. `style` names a styles.xml paragraph style. */
export function para(segs: RunSeg[] | string, style?: string): string {
  const list: RunSeg[] = typeof segs === 'string' ? [{ text: segs }] : segs
  const ppr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''
  return `<w:p>${ppr}${list.map(run).join('')}</w:p>`
}

/** A heading paragraph at level 1–3. */
export function heading(text: string, level: 1 | 2 | 3): string {
  return para(text, `Heading${level}`)
}

/** A labelled body block: the bold label paragraph, then one paragraph
 * per line of the (possibly multi-line) recorded text. */
export function labelledBlock(label: string, text: string): string[] {
  const out = [para([{ text: `${label}:`, bold: true }])]
  for (const line of text.split(/\r?\n/)) out.push(para(line))
  return out
}

/** word/document.xml around the assembled body paragraphs. */
export function documentXml(bodyParas: string[]): string {
  const sectPr =
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" ' +
    'w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<w:document xmlns:w="${W_NS}" ` +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<w:body>${bodyParas.join('')}${sectPr}</w:body></w:document>`
  )
}

export const CONTENT_TYPES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ' +
  'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ' +
  'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '</Types>'

export const RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" ' +
  'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ' +
  'Target="word/document.xml"/></Relationships>'

export const DOC_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" ' +
  'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" ' +
  'Target="styles.xml"/></Relationships>'

interface StyleOpts {
  /** OOXML hex colour (no '#') for the style's runs. */
  color?: string
  /** Display face for the style's runs (named-first; Word falls back). */
  font?: string
  /** Paragraph shading fill (OOXML hex) — the Title's ink band. */
  shade?: string
  /** Bottom border colour (OOXML hex) under the paragraph. */
  rule?: string
}

function styleDef(id: string, name: string, sizeHalfPts: number, bold: boolean, outline?: number, opts: StyleOpts = {}): string {
  const outlineEl = outline !== undefined ? `<w:outlineLvl w:val="${outline}"/>` : ''
  const shadeEl = opts.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${opts.shade}"/>` : ''
  const ruleEl = opts.rule
    ? `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="${opts.rule}"/></w:pBdr>`
    : ''
  const fontEl = opts.font ? `<w:rFonts w:ascii="${opts.font}" w:hAnsi="${opts.font}"/>` : ''
  const colorEl = opts.color ? `<w:color w:val="${opts.color}"/>` : ''
  return (
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>` +
    `<w:pPr><w:spacing w:before="120" w:after="80"/>${outlineEl}${shadeEl}${ruleEl}</w:pPr>` +
    `<w:rPr>${fontEl}<w:sz w:val="${sizeHalfPts}"/>${bold ? '<w:b/>' : ''}${colorEl}</w:rPr></w:style>`
  )
}

export const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  `<w:styles xmlns:w="${W_NS}">` +
  '<w:docDefaults><w:rPrDefault><w:rPr>' +
  '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/>' +
  '</w:rPr></w:rPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">' +
  '<w:name w:val="Normal"/><w:pPr><w:spacing w:after="80"/></w:pPr></w:style>' +
  // House brand (the logo palette): the Title sits on the interior-ink
  // band in near-white with a diamond-red rule; Heading1 is diamond red
  // over a crosshair-blue rule; Heading2/3 are interior ink. Body text
  // keeps the docDefaults face — the title and headings carry the brand.
  styleDef('Title', 'Title', 56, true, undefined, { color: 'FAFAFA', font: 'Space Grotesk', shade: '0B1120', rule: 'CF2B4D' }) +
  styleDef('Heading1', 'heading 1', 32, true, 0, { color: 'CF2B4D', font: 'Space Grotesk', rule: '38BDF8' }) +
  styleDef('Heading2', 'heading 2', 26, true, 1, { color: '0B1120', font: 'Space Grotesk' }) +
  styleDef('Heading3', 'heading 3', 24, true, 2, { color: '0B1120', font: 'Space Grotesk' }) +
  styleDef('BrandLine', 'BrandLine', 20, true, undefined, { font: 'JetBrains Mono' }) +
  '</w:styles>'
