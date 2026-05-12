import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/custom/eyebrow";
import { Badge } from "@/components/ui/badge";
import { ArrowRight } from "lucide-react";

function HeroSection() {
  return (
    <section style={{ backgroundColor: "#fcfaf7", minHeight: "100vh", padding: "120px 40px 80px", display: "flex", alignItems: "center" }}>
      <div style={{ maxWidth: "1200px", margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "64px", alignItems: "center", width: "100%" }}>
        <div style={{ display: "flex", flexDirection: "column" as const, gap: "24px" }}>
          <Eyebrow variant="coral">Responsible AI Consulting</Eyebrow>
          <h1 style={{ fontFamily: "Space Grotesk", fontSize: "52px", fontWeight: 500, letterSpacing: "-1.5px", lineHeight: "110%", color: "#2c3436", margin: 0 }}>
            Navigate AI with confidence and clarity
          </h1>
          <p style={{ fontFamily: "Inter", fontSize: "18px", fontWeight: 300, lineHeight: "120%", color: "#636e72", margin: 0 }}>
            PG Labs helps humanitarian and development organizations adopt AI responsibly — from strategy to implementation.
          </p>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" as const }}>
            <Button variant="primary" size="lg">Assess Your Readiness <ArrowRight size={18} /></Button>
            <Button variant="cta" size="lg">Learn More</Button>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" as const }}>
            <Badge variant="blue">Governance</Badge>
            <Badge variant="purple">AI Literacy</Badge>
            <Badge variant="gold">Capacity</Badge>
          </div>
        </div>
        <div style={{ borderRadius: "24px", height: "400px", backgroundImage: "linear-gradient(135deg, #e87964, #64a0b4)", opacity: 0.15 }} />
      </div>
    </section>
  );
}

const meta = {
  title: "Patterns/Hero",
  component: HeroSection,
  parameters: { layout: "fullscreen", backgrounds: { default: "cream" } },
  tags: ["autodocs"],
} satisfies Meta<typeof HeroSection>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
