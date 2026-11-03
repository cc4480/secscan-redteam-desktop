/**
 * Report branding and team section — extracted from sections.ts to keep the
 * section module under the 300-line budget. Pure string builders; the mark is
 * inlined so the standalone report carries the brand with no external asset.
 */
import { esc } from './tokens.js'

/** The inlined brand mark (crosshair). Artwork: apps/desktop/resources/icon.svg. */
export const BRAND_MARK_SVG =
  '<svg width="46" height="46" viewBox="0 0 1104 1104" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="SecScan RedTeam">' +
  '<g transform="translate(40 32)"><rect x="56" y="56" width="912" height="912" rx="225" fill="#0B1120"/>' +
  '<path fill="#CF2B4D" fill-rule="evenodd" d="M512 117L917 210L917 483L512 927L107 483L107 210Z M512 242L787 295L787 480L512 795L237 480L237 295Z"/>' +
  '<circle cx="512" cy="481" r="101" fill="none" stroke="#38BDF8" stroke-width="22"/>' +
  '<g fill="#38BDF8"><rect x="501" y="342" width="22" height="103"/><rect x="501" y="517" width="22" height="103"/><rect x="373" y="470" width="103" height="22"/><rect x="548" y="470" width="103" height="22"/><circle cx="512" cy="481" r="18"/></g></g></svg>'

/** The cover's brand row: the mark plus the SecScan RedTeam wordmark. */
export function brandRow(): string {
  return (
    `<div class="brand-row">${BRAND_MARK_SVG}<div class="brand-words">` +
    '<div class="brand-name">SecScan <span>RedTeam</span></div>' +
    '<div class="brand-sub">Autonomous Red Team Operations</div></div></div>'
  )
}

/** One fleet seat's line on the report's team section. `summary` is
 * the seat's contribution to this engagement; absent renders the
 * role alone. */
export interface TeamMember {
  agent: string
  seat: string
  role: string
  summary?: string
}

/** The engagement team: every fleet seat that ran, its role, and its
 * contribution — rendered after the posture banner. */
export function teamSection(team: TeamMember[]): string {
  const cards = team.map(
    m =>
      `<div class="team-card"><div class="team-agent">${esc(m.agent)}</div>` +
      `<div class="team-seat">${esc(m.seat)}</div>` +
      `<p class="team-role">${esc(m.role)}</p>` +
      (m.summary ? `<p class="team-summary">${esc(m.summary)}</p>` : '') +
      '</div>',
  )
  return `<h2 class="sec-title">Engagement Team</h2><div class="team-grid">${cards.join('')}</div>`
}
