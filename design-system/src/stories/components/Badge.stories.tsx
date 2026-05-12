import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "@/components/ui/badge";

const meta = {
  title: "Components/Badge",
  component: Badge,
  parameters: { layout: "centered", backgrounds: { default: "cream" } },
  tags: ["autodocs"],
  argTypes: {
    variant: { control: "select", options: ["default", "blue", "gold", "purple", "dark", "outline"] },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { children: "AI Readiness", variant: "default" } };
export const Blue: Story = { args: { children: "Phase 01", variant: "blue" } };
export const Gold: Story = { args: { children: "Capacity", variant: "gold" } };
export const Purple: Story = { args: { children: "Literacy", variant: "purple" } };

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", padding: "24px" }}>
      <Badge variant="default">Orange</Badge>
      <Badge variant="blue">Blue</Badge>
      <Badge variant="gold">Gold</Badge>
      <Badge variant="purple">Purple</Badge>
      <Badge variant="outline">Outline</Badge>
    </div>
  ),
};

export const DarkBadge: Story = {
  args: { children: "Featured", variant: "dark" },
  parameters: { backgrounds: { default: "dark-grey" } },
};
