import * as React from "react";
import { cn } from "@/lib/utils";

interface Partner {
  name: string;
  logo?: React.ReactNode;
}

interface PartnerLogosProps {
  partners?: Partner[];
  className?: string;
}

const defaultPartners: Partner[] = [
  { name: "Partner A" },
  { name: "Partner B" },
  { name: "Partner C" },
  { name: "Partner D" },
  { name: "Partner E" },
  { name: "Partner F" },
];

function LogoPlaceholder({ name }: { name: string }) {
  return (
    <div className="h-8 flex items-center justify-center px-4">
      <span className="font-display text-label uppercase tracking-widest text-neutral-muted">
        {name}
      </span>
    </div>
  );
}

export function PartnerLogos({ partners = defaultPartners, className }: PartnerLogosProps) {
  return (
    <div className={cn("w-full", className)}>
      <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-6">
        {partners.map((partner) => (
          <div
            key={partner.name}
            className="opacity-50 hover:opacity-80 transition-opacity"
          >
            {partner.logo ?? <LogoPlaceholder name={partner.name} />}
          </div>
        ))}
      </div>
    </div>
  );
}
