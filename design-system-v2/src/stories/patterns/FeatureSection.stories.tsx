import type { Meta, StoryObj } from "@storybook/react";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { SectionHeading } from "@/components/custom/section-heading";
import { IconCircle } from "@/components/custom/icon-circle";
import { Shield, Globe, Heart, Lightbulb } from "lucide-react";

const features = [
  {
    icon: Shield,
    color: "brand" as const,
    accent: "brand" as const,
    title: "Responsible AI design",
    description:
      "Embed ethical principles and accountability into every stage of AI development.",
  },
  {
    icon: Globe,
    color: "gold" as const,
    accent: "gold" as const,
    title: "Funder alignment",
    description: "Align AI initiatives with funding priorities and reporting requirements.",
  },
  {
    icon: Heart,
    color: "coral" as const,
    accent: "coral" as const,
    title: "Risk mitigation",
    description: "Identify and address potential harms before they impact communities.",
  },
  {
    icon: Lightbulb,
    color: "azure" as const,
    accent: "azure" as const,
    title: "Strategic roadmaps",
    description: "Clear, phased plans to move from AI strategy to measurable outcomes.",
  },
];

function FeatureSection() {
  return (
    <section style={{ backgroundColor: "#fff", padding: "104px 40px" }}>
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        <SectionHeading
          eyebrow="What we do"
          title="End-to-end AI readiness support"
          lede="The technology to guide, match and credential people at scale already exists. We build it for the organizations serving the people who need it most."
          style={{ marginBottom: "64px" }}
        />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "24px" }}>
          {features.map((f) => (
            <Card key={f.title} accent={f.accent} style={{ height: "100%" }}>
              <IconCircle color={f.color} style={{ marginBottom: "20px" }}>
                <f.icon size={18} />
              </IconCircle>
              <CardTitle style={{ marginBottom: "10px" }}>{f.title}</CardTitle>
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
