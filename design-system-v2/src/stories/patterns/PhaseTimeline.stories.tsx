import type { Meta, StoryObj } from "@storybook/react";
import { PhaseCard } from "@/components/custom/phase-card";
import { SectionHeading } from "@/components/custom/section-heading";

/* Deck slide 23 — "Turning talent into employment, faster." */
function PhaseTimeline() {
  return (
    <section style={{ backgroundColor: "#f4f6f8", padding: "104px 40px" }}>
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        <SectionHeading
          eyebrow="Our framework"
          title="A phased approach to AI readiness"
          lede="Four interconnected phases, each one building on the evidence the last produced."
          align="center"
          style={{ marginBottom: "64px" }}
        />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "32px" }}>
          <PhaseCard
            phase="01"
            title="AI governance"
            description="Establish policies and accountability structures for responsible AI use."
            color="brand"
          />
          <PhaseCard
            phase="02"
            title="AI literacy"
            description="Build organizational understanding of AI capabilities and limitations."
            color="gold"
          />
          <PhaseCard
            phase="03"
            title="Capacity building"
            description="Develop technical capabilities and human expertise for AI adoption."
            color="coral"
          />
          <PhaseCard
            phase="04"
            title="AI integration"
            description="Embed AI tools into workflows with continuous monitoring."
            color="azure"
          />
        </div>
      </div>
    </section>
  );
}

const meta = {
  title: "Patterns/Phase Timeline",
  component: PhaseTimeline,
  parameters: { layout: "fullscreen", backgrounds: { default: "surface" } },
  tags: ["autodocs"],
} satisfies Meta<typeof PhaseTimeline>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
