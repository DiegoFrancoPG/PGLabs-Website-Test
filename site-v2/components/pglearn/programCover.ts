/*
 * Cover photography for program cards.
 *
 * Programs have no image of their own yet — the Enrollment contract carries
 * none — so each program is given one of the site's licensed photographs,
 * chosen from its id. The same program always gets the same cover, on every
 * screen and for every learner. When programs gain a cover field, this is the
 * one place to read it instead.
 */
const COVERS = [
  "/human-imagery/01_Hero_Cover/pexels-a-darmel-8134073.jpg",
  "/human-imagery/01_Hero_Cover/pexels-kampus-8636605.jpg",
  "/human-imagery/02_Responsible_AI_Governance/pexels-edmond-dantes-8555934.jpg",
  "/human-imagery/03_Human_Centered_Design/pexels-kampus-7983573.jpg",
  "/human-imagery/04%20Readiness/pexels-fauxels-3184285.jpg",
  "/human-imagery/04%20Readiness/pexels-mikhail-nilov-6592723.jpg",
  "/human-imagery/05_Strategy_Capacity/pexels-andres-ayrton-6578426.jpg",
  "/human-imagery/05_Strategy_Capacity/pexels-kampus-8204326.jpg",
  "/human-imagery/05_Strategy_Capacity/pexels-rdne-7414106.jpg",
  "/human-imagery/05_Strategy_Capacity/pexels-theo-decker-5945809.jpg",
] as const;

export function programCover(programId: string): string {
  // FNV-1a over the id: stable, cheap, and spreads adjacent uuids apart.
  let hash = 0x811c9dc5;
  for (let i = 0; i < programId.length; i++) {
    hash ^= programId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return COVERS[(hash >>> 0) % COVERS.length];
}
