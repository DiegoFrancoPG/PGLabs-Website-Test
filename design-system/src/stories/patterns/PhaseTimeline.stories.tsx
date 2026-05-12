import type { Meta, StoryObj } from "@storybook/react";
import { PhaseCard } from "@/components/custom/phase-card";
import { Eyebrow } from "@/components/custom/eyebrow";

function PhaseTimeline() {
  return (
    <section style={{ backgroundColor: "#fcfaf7", padding: "80px 40px" }}>
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        <div style={{ display: "flex", flexDirection: "column" as const, gap: "12px", marginBottom: "48px", textAlign: "center" as const, alignItems: "center" }}>
          <Eyebrow variant="default">Our Framework</Eyebrow>
          <h2 style={{ fontFamily: "Space Grotesk", fontSize: "32px", fontWeight: 500, letterSpacing: "-0.86px", color: "#2c3436", margin: 0 }}>
            A phased approach to AI readiness
          </h2>
          <p style={{ fontFamily: "Inter", fontSize: "15px", color: "#636e72", maxWidth: "560px", margin: 0 }}>
            Our methodology guides organizations through four interconnected phases.
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
          <PhaseCard phase="Phase 01" title="AI Governance" description="Establish policies and accountability structures for responsible AI use." color="blue" />
          <PhaseCard phase="Phase 02" title="AI Literacy" description="Build organizational understanding of AI capabilities and limitations." color="purple" />
          <PhaseCard phase="Phase 03" title="Capacity Building" description="Develop technical capabilities and human expertise for AI adoption." color="gold" />
          <PhaseCard phase="Phase 04" title="AI Integration" description="Embed AI tools into workflows with continuous monitoring." color="orange" />
        </div>
      </div>
    </section>
  );
}

const meta = {
  title: "Patterns/Phase Timeline",
  component: PhaseTimeline,
  parameters: { layout: "fullscreen", backgrounds: { default: "cream" } },
  tags: ["autodocs"],
} satisfies Meta<typeof PhaseTimeline>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
