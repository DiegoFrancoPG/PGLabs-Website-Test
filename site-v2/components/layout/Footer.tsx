import Link from "next/link";

const PGLabsLogo = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="24" viewBox="0 0 34 30" fill="none">
    <path d="M4.92717 5.51927C5.4921 3.83754 4.31969 1.77836 2.34897 0.929663C2.30269 2.54757 3.18523 4.07528 4.92717 5.51927Z" fill="white"/>
    <path d="M9.1099 4.375C8.64363 2.96386 7.52807 1.07151 5.93853 0C6.18075 3.85013 6.40568 7.69989 8.97952 11.3252C8.62596 9.54085 9.57419 5.7844 9.1099 4.375Z" fill="white"/>
    <path d="M8.3254 12.9053C7.56715 10.2441 3.73891 4.03314 0 4.64236C2.71032 7.28214 3.06338 11.4139 7.38116 12.8344C7.74306 12.9522 8.06166 12.9426 8.3254 12.9053Z" fill="white"/>
    <path d="M10.7513 15.6079C8.70067 13.5778 4.97706 11.9931 2.75218 15.0274C5.7082 16.8667 8.55562 16.8903 11.3071 16.6443C11.2652 16.4509 11.1631 16.0172 10.7513 15.6079Z" fill="white"/>
    <path d="M13.1595 10.5317C12.2549 8.75646 11.8758 7.30837 9.81839 4.69036C9.85771 8.88161 8.76766 13.1529 13.1986 16.9157C13.0321 14.8012 14.064 12.307 13.1595 10.5317Z" fill="white"/>
    <path d="M13.7689 18.7969C11.5635 16.9506 8.62193 16.9341 6.38336 20.4869C9.07589 22.3246 11.5087 21.449 13.7689 18.7969Z" fill="white"/>
    <path d="M15.4516 19.9099C12.3553 19.339 11.4383 23.9546 12.3467 25.8282C15.0428 25.8682 17.3409 24.1051 17.3392 21.8163C17.3408 21.115 16.8736 20.6527 16.5637 20.4332C16.3037 20.2473 16.0139 20.016 15.4516 19.9099Z" fill="white"/>
    <path d="M20.9751 16.8041C20.982 15.1049 20.3917 14.8406 19.0362 12.3683C18.0023 16.4295 15.3759 16.4267 18.0766 20.9012C18.992 19.344 20.9662 18.7251 20.9751 16.8041Z" fill="white"/>
    <path d="M12.762 8.44191C12.762 8.44191 14.2765 10.2177 14.1794 12.4284C14.0822 14.6405 13.9945 16.149 15.0925 18.4764C16.7056 16.3132 17.4193 14.859 17.2327 13.9363C17.0462 13.014 16.1087 10.1204 12.762 8.44191Z" fill="white"/>
    <path d="M21.0265 23.6143C24.8196 24.3174 29.4539 28.8424 33.642 25.7303C33.8607 25.2271 33.5594 24.2217 33.2729 24.584C31.5971 26.6851 26.5379 25.9394 21.6937 22.8708C21.193 22.5597 20.1827 23.3967 21.0265 23.6143Z" fill="white"/>
  </svg>
);

const QUICK_LINKS = [
  { label: "Home", href: "/" },
  { label: "Services", href: "/services" },
  { label: "AI Readiness", href: "/ai-readiness" },
  { label: "Work", href: "/work" },
  { label: "About", href: "/about" },
];

const colHeading = "text-label uppercase text-white/40";

export function Footer() {
  return (
    <footer className="bg-ink-900 text-white pt-22 pb-10">
      <div className="max-w-content mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-14 pb-14 border-b border-white/12">
          {/* Brand */}
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-2.5">
              <PGLabsLogo />
              <span className="font-display text-[20px] font-bold text-white tracking-[-0.02em]">
                PG Labs
              </span>
            </div>
            <p className="text-body-sm text-white/60 max-w-measure">
              The R&amp;D lab of PeaceGeeks Society, a registered Canadian charity
              empowering communities through technology.
            </p>
            <p className="text-source text-white/35">Charity # 844504780RR0001</p>
            <div className="flex gap-5">
              <a
                href="https://ca.linkedin.com/company/peace-geeks"
                target="_blank"
                rel="noopener noreferrer"
                className="text-body-sm text-white/60 hover:text-white transition-colors"
              >
                LinkedIn
              </a>
              <a
                href="https://www.peacegeeks.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-body-sm text-white/60 hover:text-white transition-colors"
              >
                PeaceGeeks
              </a>
            </div>
          </div>

          {/* Quick links */}
          <div className="flex flex-col gap-4">
            <p className={colHeading}>Quick links</p>
            {QUICK_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-body-sm text-white/60 hover:text-white transition-colors w-fit"
              >
                {l.label}
              </Link>
            ))}
          </div>

          {/* Contact */}
          <div className="flex flex-col gap-4">
            <p className={colHeading}>Contact</p>
            <a
              href="mailto:info@peacegeeks.org"
              className="text-body-sm text-white/60 hover:text-white transition-colors w-fit"
            >
              info@peacegeeks.org
            </a>
            <p className="text-body-sm text-white/60">
              410 W. Georgia Street
              <br />
              Vancouver, BC V6B 1Z3
              <br />
              Canada
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 flex-wrap pt-8">
          <p className="text-source text-white/35">
            © 2026 PG Labs / PeaceGeeks Society
          </p>
          <Link
            href="/privacy"
            className="text-source text-white/35 hover:text-white/60 transition-colors"
          >
            Privacy policy
          </Link>
        </div>
      </div>
    </footer>
  );
}
