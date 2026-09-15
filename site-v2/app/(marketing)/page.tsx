import { Hero } from "@/components/sections/Hero";
import { WhatWeDo } from "@/components/sections/WhatWeDo";
import { FeaturedProgram } from "@/components/sections/FeaturedProgram";
import { OurWork } from "@/components/sections/OurWork";
import { Testimonials } from "@/components/sections/Testimonials";
import { OurHeritage } from "@/components/sections/OurHeritage";

export default function HomePage() {
  return (
    <>
      <Hero />
      <WhatWeDo />
      <FeaturedProgram />
      <OurWork />
      <Testimonials />
      <OurHeritage />
    </>
  );
}
