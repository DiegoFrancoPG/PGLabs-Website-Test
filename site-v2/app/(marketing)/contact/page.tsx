import type { Metadata } from "next";
import { Mail, MapPin, Clock } from "lucide-react";
import { Eyebrow } from "@ds/components/custom/eyebrow";
import { IconCircle } from "@ds/components/custom/icon-circle";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Get in touch with PG Labs. Book a free 30-minute discovery call or send us a message.",
};

const CONTACT_ITEMS = [
  {
    label: "Email",
    value: "info@peacegeeks.org",
    icon: Mail,
    href: "mailto:info@peacegeeks.org",
  },
  { label: "Location", value: "410 W. Georgia St, Vancouver, BC V6B 1Z3", icon: MapPin },
  { label: "Response time", value: "Within 2 business days", icon: Clock },
];

export default function ContactPage() {
  return (
    <>
      {/* Hero */}
      <section className="pt-22 pb-16 px-6 border-b border-steel-200">
        <div className="max-w-content mx-auto">
          <Eyebrow variant="brand">Get started</Eyebrow>
          <h1 className="font-display text-h1-sm md:text-display mt-7 max-w-[20ch]">
            Let&rsquo;s talk about{" "}
            your mission.
          </h1>
          <p className="text-lede text-steel-500 mt-8 max-w-prose">
            Book a free 30-minute discovery call or send us a message. We&rsquo;d
            love to learn about your organization and explore how we can help.
          </p>
        </div>
      </section>

      {/* Contact grid */}
      <section className="py-22 px-6">
        <div className="max-w-content mx-auto grid grid-cols-1 md:grid-cols-3 gap-14">
          {/* Form */}
          <div className="md:col-span-2 bg-white rounded-sm border border-steel-200 p-10 min-h-[480px]">
            <iframe
              data-tally-src="https://tally.so/embed/5BkV76?alignLeft=1&hideTitle=1&dynamicHeight=1"
              loading="lazy"
              width="100%"
              height="566"
              frameBorder={0}
              title="Book a PG Labs Discovery Call"
            />
            <script
              dangerouslySetInnerHTML={{
                __html: `var d=document,w="https://tally.so/widgets/embed.js",v=function(){"undefined"!=typeof Tally?Tally.loadEmbeds():d.querySelectorAll("iframe[data-tally-src]:not([src])").forEach(function(e){e.src=e.dataset.tallySrc})};if("undefined"!=typeof Tally)v();else if(d.querySelector('script[src="'+w+'"]')==null){var s=d.createElement("script");s.src=w,s.onload=v,s.onerror=v,d.body.appendChild(s);}`,
              }}
            />
          </div>

          {/* Sidebar */}
          <div className="flex flex-col gap-12">
            <div className="border-t border-steel-200 pt-8 flex flex-col gap-7">
              <p className="text-eyebrow uppercase text-steel-400">Contact details</p>
              {CONTACT_ITEMS.map((item) => (
                <div key={item.label} className="flex items-start gap-4">
                  <IconCircle color="ink" size="sm">
                    <item.icon className="w-4 h-4" />
                  </IconCircle>
                  <div>
                    <p className="text-label uppercase text-steel-400 mb-1">{item.label}</p>
                    {item.href ? (
                      <a
                        href={item.href}
                        className="text-body-sm text-ink-800 hover:text-brand-600 transition-colors"
                      >
                        {item.value}
                      </a>
                    ) : (
                      <p className="text-body-sm text-ink-800">{item.value}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="border-l-2 border-l-brand-500 bg-surface p-7">
              <p className="text-body-sm text-steel-500">
                Not sure where to start? That&rsquo;s completely normal. Most of our
                clients come to us knowing they need help with technology but
                aren&rsquo;t sure exactly what. That&rsquo;s what the discovery call
                is for.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
