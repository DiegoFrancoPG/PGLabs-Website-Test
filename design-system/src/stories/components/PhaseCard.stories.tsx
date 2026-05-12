import type { Meta, StoryObj } from "@storybook/react";
import { PhaseCard } from "@/components/custom/phase-card";

const meta = {
  title: "Components/PhaseCard",
  component: PhaseCard,
  parameters: { layout: "centered", backgrounds: { default: "cream" } },
  tags: ["autodocs"],
  argTypes: {
    color: { control: "select", options: ["orange", "blue", "gold", "purple"] },
  },
} satisfies Meta<typeof PhaseCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    phase: "Phase 01",
    title: "AI Governance",
    description: "Establish policies and accountability structures for responsible AI use.",
    color: "blue",
  },
};

export const AllPhases: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" as const }}>
      <PhaseCard phase="Phase 01" title="Governance" description="Policies and accountability structures." color="blue" />
      <PhaseCard phase="Phase 02" title="Literacy" description="Build organizational AI knowledge." color="purple" />
      <PhaseCard phase="Phase 03" title="Capacity" description="Develop technical capabilities." color="gold" />
      <PhaseCard phase="Phase 04" title="Integration" description="Embed AI into workflows." color="orange" />
    </div>
  ),
};
