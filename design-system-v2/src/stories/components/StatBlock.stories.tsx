import type { Meta, StoryObj } from "@storybook/react";
import { StatBlock } from "@/components/custom/stat-block";

const meta = {
  title: "Components/StatBlock",
  component: StatBlock,
  parameters: { layout: "centered", backgrounds: { default: "white" } },
  tags: ["autodocs"],
  argTypes: {
    color: { control: "select", options: ["ink", "brand", "gold", "coral", "white"] },
    size: { control: "select", options: ["sm", "default", "lg"] },
    ruled: { control: "boolean" },
  },
} satisfies Meta<typeof StatBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    value: "120M+",
    caption: "People forcibly displaced worldwide. Conflict and instability are accelerating, not slowing.",
    source: "UNHCR, 2025",
  },
};

export const Brand: Story = {
  args: {
    value: "$69",
    caption: "Per refugee reached — the same outcomes at a fraction of legacy cost.",
    color: "brand",
  },
};

/** The deck's global-picture slide: three stats in a row, divided by hairlines. */
export const StatRow: Story = {
  args: { value: "", caption: "" },
  render: () => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 260px)", gap: "40px", padding: "32px" }}>
      <StatBlock
        ruled
        value="120M+"
        caption="People forcibly displaced worldwide."
        source="UNHCR, 2025"
      />
      <StatBlock
        ruled
        value="155/204"
        caption="Countries facing population decline by 2050."
        source="The Lancet, 2024"
        color="gold"
      />
      <StatBlock
        ruled
        value="0"
        caption="Countries connecting these realities at scale."
        source="PeaceGeeks analysis"
        color="coral"
      />
    </div>
  ),
};

/** Impact-at-scale treatment — oversized figures on ink. */
export const OnInk: Story = {
  args: { value: "", caption: "" },
  render: () => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 240px)",
        gap: "40px",
        padding: "48px",
        backgroundColor: "#1a2230",
      }}
    >
      <StatBlock size="lg" color="white" value="380K+" caption="Total users, 2023–2025." />
      <StatBlock size="lg" color="white" value="167K+" caption="Guided by the AI coach." />
      <StatBlock size="lg" color="white" value="150+" caption="Countries reached." />
    </div>
  ),
  parameters: { backgrounds: { default: "ink" } },
};

export const Sizes: Story = {
  args: { value: "", caption: "" },
  render: () => (
    <div style={{ display: "flex", gap: "48px", alignItems: "flex-end", padding: "24px" }}>
      <StatBlock size="sm" value="19" caption="White-label partners." />
      <StatBlock size="default" value="43K+" caption="Conversations coached." />
      <StatBlock size="lg" value="380K+" caption="Total users." />
    </div>
  ),
};
