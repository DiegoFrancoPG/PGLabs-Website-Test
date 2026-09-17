import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/custom/eyebrow";
import { StatBlock } from "@/components/custom/stat-block";
import { ArrowRight } from "lucide-react";

/*
 * Editorial hero, after the deck's title slide: kicker, a serif headline whose
 * second clause carries the emphasis, a lede, then proof stats on the same rule.
 */
function HeroSection() {
  return (
    <section style={{ backgroundColor: "#1a2230", padding: "136px 40px 104px", color: "#fff" }}>
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        <div style={{ maxWidth: "20ch" }}>
          <Eyebrow variant="white">PeaceGeeks · New York</Eyebrow>
        </div>

        <h1
          style={{
            fontFamily: "'Playfair Display', Georgia, serif",
            fontSize: "64px",
            fontWeight: 600,
            letterSpacing: "-0.025em",
            lineHeight: 1.05,
            margin: "24px 0 0",
            maxWidth: "24ch",
            textWrap: "balance" as const,
          }}
        >
          Unleashing human capital{" "}
          <em style={{ fontStyle: "italic", color: "#59c4ed" }}>at scale</em>.
        </h1>

        <p
          style={{
            fontFamily: "'Open Sans', sans-serif",
            fontSize: "22px",
            fontWeight: 300,
            lineHeight: 1.5,
            color: "rgba(255,255,255,0.72)",
            margin: "28px 0 0",
            maxWidth: "56ch",
          }}
        >
          Rebuilding the systems that connect talent to opportunity — for the
          people the technology was never built for.
        </p>

        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" as const, marginTop: "40px" }}>
          <Button variant="primary" size="lg">
            <span>Book a meeting</span>
            <ArrowRight size={18} />
          </Button>
          <Button variant="ghost" size="lg">
            See our work
          </Button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 240px))",
            gap: "40px",
            marginTop: "88px",
          }}
        >
          <StatBlock ruled size="sm" color="white" value="380K+" caption="Total users, 2023–2025." />
          <StatBlock ruled size="sm" color="white" value="150+" caption="Countries reached." />
          <StatBlock ruled size="sm" color="white" value="$69" caption="Per refugee reached." />
        </div>
      </div>
    </section>
  );
}

const meta = {
  title: "Patterns/Hero",
  component: HeroSection,
  parameters: { layout: "fullscreen", backgrounds: { default: "ink" } },
  tags: ["autodocs"],
} satisfies Meta<typeof HeroSection>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
