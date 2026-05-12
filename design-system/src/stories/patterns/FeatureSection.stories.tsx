import type { Meta, StoryObj } from "@storybook/react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Eyebrow } from "@/components/custom/eyebrow";
import { IconCircle } from "@/components/custom/icon-circle";
import { Shield, Globe, Heart, Lightbulb } from "lucide-react";

const features = [
  { icon: Shield, color: "orange" as const, accent: "orange" as const, title: "Responsible AI Design", description: "Embed ethical principles and accountability into every stage of AI development." },
  { icon: Globe, color: "blue" as const, accent: "blue" as const, title: "Funder Alignment", description: "Align AI initiatives with funding priorities and reporting requirements." },
  { icon: Heart, color: "gold" as const, accent: "gold" as const, title: "Risk Mitigation", description: "Identify and address potential harms before they impact communities." },
  { icon: Lightbulb, color: "purple" as const, accent: "none" as const, title: "Strategic Roadmaps", description: "Clear, phased plans to move from AI strategy to measurable outcomes." },
];

function FeatureSection() {
  return (
    <section style={{ backgroundColor: "#fff", padding: "80px 40px" }}>
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        <div style={{ display: "flex", flexDirection: "column" as const, gap: "12px", marginBottom: "48px" }}>
          <Eyebrow variant="coral">What We Do</Eyebrow>
          <h2 style={{ fontFamily: "Space Grotesk", fontSize: "32px", fontWeight: 500, letterSpacing: "-0.86px", color: "#2c3436", margin: 0 }}>
            End-to-end AI readiness support
          </h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
          {features.map((f) => (
            <Card key={f.title} variant="default" accent={f.accent} style={{ height: "100%" }}>
              <CardHeader>
                <IconCircle color={f.color}><f.icon size={18} /></IconCircle>
                <CardTitle>{f.title}</CardTitle>
              </CardHeader>
              <CardDescription>{f.description}</CardDescription>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

const meta = {
  title: "Patterns/Feature Section",
  component: FeatureSection,
  parameters: { layout: "fullscreen", backgrounds: { default: "white" } },
  tags: ["autodocs"],
} satisfies Meta<typeof FeatureSection>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
