import type { Meta, StoryObj } from "@storybook/react";
import { MiniCard } from "@/components/custom/mini-card";

const meta = {
  title: "Components/MiniCard",
  component: MiniCard,
  parameters: { layout: "centered", backgrounds: { default: "cream" } },
  tags: ["autodocs"],
  argTypes: {
    color: { control: "select", options: ["orange", "blue", "gold"] },
  },
} satisfies Meta<typeof MiniCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { number: 1, title: "Risk Assessment", description: "Identify potential harms", color: "orange" },
};

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column" as const, gap: "8px", width: "300px" }}>
      <MiniCard number={1} title="Risk Assessment" description="Identify potential harms" color="orange" />
      <MiniCard number={2} title="Governance Review" description="Policy alignment check" color="blue" />
      <MiniCard number={3} title="Capacity Building" description="Team training needs" color="gold" />
    </div>
  ),
};
