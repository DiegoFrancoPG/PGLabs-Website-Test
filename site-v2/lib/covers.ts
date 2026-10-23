/*
 * The design system's photograph library (public/human-imagery), which an
 * administrator can choose a program cover from (D-19). Paths are URL-encoded
 * exactly as the browser requests them; M37 accepts any path under
 * /human-imagery/, and the API accepts only these.
 *
 * Regenerate when the library changes: list the folder, keep image files.
 */
export interface LibraryCover {
  group: string;
  src: string;
}

export const COVER_LIBRARY: readonly LibraryCover[] = [
  { group: "Hero", src: "/human-imagery/01_Hero_Cover/ChatGPT%20Image%2029%20de%20mai.%20de%202026%2C%2009_21_14.png" },
  { group: "Hero", src: "/human-imagery/01_Hero_Cover/ChatGPT%20Image%2029%20de%20mai.%20de%202026%2C%2009_23_09.png" },
  { group: "Hero", src: "/human-imagery/01_Hero_Cover/pexels-a-darmel-8134073.jpg" },
  { group: "Hero", src: "/human-imagery/01_Hero_Cover/pexels-kampus-8636605.jpg" },
  { group: "Hero", src: "/human-imagery/01_Hero_Cover/pexels-katetrysh-10619968.jpg" },
  { group: "Hero", src: "/human-imagery/01_Hero_Cover/pexels-srijonism-34987125.jpg" },
  { group: "Responsible AI governance", src: "/human-imagery/02_Responsible_AI_Governance/ChatGPT%20Image%2029%20may%202026%2C%2008_15_45.png" },
  { group: "Responsible AI governance", src: "/human-imagery/02_Responsible_AI_Governance/pexels-edmond-dantes-8555934.jpg" },
  { group: "Responsible AI governance", src: "/human-imagery/02_Responsible_AI_Governance/pexels-rdne-9034716.jpg" },
  { group: "Human-centred design", src: "/human-imagery/03_Human_Centered_Design/ChatGPT%20Image%2029%20may%202026%2C%2008_11_38.png" },
  { group: "Human-centred design", src: "/human-imagery/03_Human_Centered_Design/d8d38b4b-e000-4e54-8811-07cdb9c62d62.png" },
  { group: "Human-centred design", src: "/human-imagery/03_Human_Centered_Design/pexels-gustavo-fring-5621936.jpg" },
  { group: "Human-centred design", src: "/human-imagery/03_Human_Centered_Design/pexels-helenalopes-27177915.jpg" },
  { group: "Human-centred design", src: "/human-imagery/03_Human_Centered_Design/pexels-kampus-7983573.jpg" },
  { group: "Human-centred design", src: "/human-imagery/03_Human_Centered_Design/pexels-keira-burton-6146951.jpg" },
  { group: "Human-centred design", src: "/human-imagery/03_Human_Centered_Design/pexels-ketut-subiyanto-4307705.jpg" },
  { group: "Human-centred design", src: "/human-imagery/03_Human_Centered_Design/pexels-ketut-subiyanto-4307867.jpg" },
  { group: "Human-centred design", src: "/human-imagery/03_Human_Centered_Design/pexels-liliana-drew-8554620.jpg" },
  { group: "Human-centred design", src: "/human-imagery/03_Human_Centered_Design/pexels-olly-3863771.jpg" },
  { group: "Human-centred design", src: "/human-imagery/03_Human_Centered_Design/pexels-rdne-6646868.jpg" },
  { group: "Human-centred design", src: "/human-imagery/03_Human_Centered_Design/pexels-rdne-6646880.jpg" },
  { group: "Human-centred design", src: "/human-imagery/03_Human_Centered_Design/pexels-rdne-6646952.jpg" },
  { group: "Human-centred design", src: "/human-imagery/03_Human_Centered_Design/pexels-rdne-6647052.jpg" },
  { group: "Human-centred design", src: "/human-imagery/03_Human_Centered_Design/pexels-rdne-7551408.jpg" },
  { group: "Human-centred design", src: "/human-imagery/03_Human_Centered_Design/pexels-ron-lach-9543406.jpg" },
  { group: "Human-centred design", src: "/human-imagery/03_Human_Centered_Design/pexels-silverkblack-36713465.jpg" },
  { group: "Readiness", src: "/human-imagery/04%20Readiness/ChatGPT%20Image%2029%20de%20mai.%20de%202026%2C%2009_15_11.png" },
  { group: "Readiness", src: "/human-imagery/04%20Readiness/ChatGPT%20Image%2029%20may%202026%2C%2008_02_18.png" },
  { group: "Readiness", src: "/human-imagery/04%20Readiness/ChatGPT%20Image%2029%20may%202026%2C%2008_09_05.png" },
  { group: "Readiness", src: "/human-imagery/04%20Readiness/ChatGPT%20Image%2029%20may%202026%2C%2008_20_16.png" },
  { group: "Readiness", src: "/human-imagery/04%20Readiness/ChatGPT%20Image%2029%20may%202026%2C%2008_24_49.png" },
  { group: "Readiness", src: "/human-imagery/04%20Readiness/ChatGPT%20Image%2029%20may%202026%2C%2008_27_46.png" },
  { group: "Readiness", src: "/human-imagery/04%20Readiness/pexels-fauxels-3184285.jpg" },
  { group: "Readiness", src: "/human-imagery/04%20Readiness/pexels-gabby-k-9489075.jpg" },
  { group: "Readiness", src: "/human-imagery/04%20Readiness/pexels-karola-g-8547194.jpg" },
  { group: "Readiness", src: "/human-imagery/04%20Readiness/pexels-karola-g-8554089.jpg" },
  { group: "Readiness", src: "/human-imagery/04%20Readiness/pexels-mikhail-nilov-6592723.jpg" },
  { group: "Readiness", src: "/human-imagery/04%20Readiness/pexels-mizunokozuki-12899103.jpg" },
  { group: "Readiness", src: "/human-imagery/04%20Readiness/pexels-pavel-danilyuk-7868975.jpg" },
  { group: "Readiness", src: "/human-imagery/04%20Readiness/pexels-pavel-danilyuk-7869070.jpg" },
  { group: "Readiness", src: "/human-imagery/04%20Readiness/pexels-polina-tankilevitch-6700497.jpg" },
  { group: "Readiness", src: "/human-imagery/04%20Readiness/pexels-polina-tankilevitch-6700548.jpg" },
  { group: "Readiness", src: "/human-imagery/04%20Readiness/pexels-polina-tankilevitch-6700551.jpg" },
  { group: "Readiness", src: "/human-imagery/04%20Readiness/pexels-polina-tankilevitch-6929351.jpg" },
  { group: "Readiness", src: "/human-imagery/04%20Readiness/pexels-rdne-7888816.jpg" },
  { group: "Readiness", src: "/human-imagery/04%20Readiness/pexels-yankrukov-7793171.jpg" },
  { group: "Readiness", src: "/human-imagery/04%20Readiness/pexels-yankrukov-7793932.jpg" },
  { group: "Readiness", src: "/human-imagery/04%20Readiness/pexels-zen-chung-5745179.jpg" },
  { group: "Strategy and capacity", src: "/human-imagery/05_Strategy_Capacity/98ea70c9-7903-47c8-9623-e46d4757a62e.png" },
  { group: "Strategy and capacity", src: "/human-imagery/05_Strategy_Capacity/ChatGPT%20Image%2029%20de%20mai.%20de%202026%2C%2008_56_26.png" },
  { group: "Strategy and capacity", src: "/human-imagery/05_Strategy_Capacity/ChatGPT%20Image%2029%20de%20mai.%20de%202026%2C%2009_18_54.png" },
  { group: "Strategy and capacity", src: "/human-imagery/05_Strategy_Capacity/pexels-ai25studioai-5466284.jpg" },
  { group: "Strategy and capacity", src: "/human-imagery/05_Strategy_Capacity/pexels-ai25studioai-5816283.jpg" },
  { group: "Strategy and capacity", src: "/human-imagery/05_Strategy_Capacity/pexels-andres-ayrton-6578426.jpg" },
  { group: "Strategy and capacity", src: "/human-imagery/05_Strategy_Capacity/pexels-ebrubodyy-17781729.jpg" },
  { group: "Strategy and capacity", src: "/human-imagery/05_Strategy_Capacity/pexels-edmond-dantes-8068875.jpg" },
  { group: "Strategy and capacity", src: "/human-imagery/05_Strategy_Capacity/pexels-kampus-8204326.jpg" },
  { group: "Strategy and capacity", src: "/human-imagery/05_Strategy_Capacity/pexels-mart-production-7644157.jpg" },
  { group: "Strategy and capacity", src: "/human-imagery/05_Strategy_Capacity/pexels-mikhail-nilov-7734568.jpg" },
  { group: "Strategy and capacity", src: "/human-imagery/05_Strategy_Capacity/pexels-mikhail-nilov-7989009.jpg" },
  { group: "Strategy and capacity", src: "/human-imagery/05_Strategy_Capacity/pexels-mikhail-nilov-8284734.jpg" },
  { group: "Strategy and capacity", src: "/human-imagery/05_Strategy_Capacity/pexels-rdne-7414106.jpg" },
  { group: "Strategy and capacity", src: "/human-imagery/05_Strategy_Capacity/pexels-rebrand-cities-581004-1367275.jpg" },
  { group: "Strategy and capacity", src: "/human-imagery/05_Strategy_Capacity/pexels-ron-lach-9222422.jpg" },
  { group: "Strategy and capacity", src: "/human-imagery/05_Strategy_Capacity/pexels-theo-decker-5945799.jpg" },
  { group: "Strategy and capacity", src: "/human-imagery/05_Strategy_Capacity/pexels-theo-decker-5945809.jpg" },
  { group: "Strategy and capacity", src: "/human-imagery/05_Strategy_Capacity/pexels-theo-decker-5946207.jpg" },
  { group: "Strategy and capacity", src: "/human-imagery/05_Strategy_Capacity/pexels-theo-decker-5946209.jpg" },
  { group: "Strategy and capacity", src: "/human-imagery/05_Strategy_Capacity/pexels-theo-decker-5954516.jpg" },
  { group: "Strategy and capacity", src: "/human-imagery/05_Strategy_Capacity/pexels-tiger-lily-7108700.jpg" },
  { group: "Strategy and capacity", src: "/human-imagery/05_Strategy_Capacity/pexels-tiger-lily-7109241.jpg" },
  { group: "Strategy and capacity", src: "/human-imagery/05_Strategy_Capacity/pexels-tima-miroshnichenko-5198235.jpg" },
];

export const isLibraryCover = (src: string) => COVER_LIBRARY.some((cover) => cover.src === src);
