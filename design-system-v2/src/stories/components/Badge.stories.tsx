import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "@/components/ui/badge";

const meta = {
  title: "Components/Badge",
  component: Badge,
  parameters: { layout: "centered", backgrounds: { default: "white" } },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "gold", "coral", "azure", "ink", "outline", "dark"],
    },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { children: "Live", variant: "default" } };
export const Gold: Story = { args: { children: "In development", variant: "gold" } };
export const Coral: Story = { args: { children: "Planned", variant: "coral" } };
export const Azure: Story = { args: { children: "Research", variant: "azure" } };
export const Ink: Story = { args: { children: "Flagship", variant: "ink" } };
export const Outline: Story = { args: { children: "Archived", variant: "outline" } };

export const AllVariants: Story = {
  args: { children: "Badge" },
  render: () => (
    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", padding: "24px" }}>
      <Badge variant="default">Live</Badge>
      <Badge variant="gold">In development</Badge>
      <Badge variant="coral">Planned</Badge>
      <Badge variant="azure">Research</Badge>
      <Badge variant="ink">Flagship</Badge>
      <Badge variant="outline">Archived</Badge>
    </div>
  ),
};

export const OnInk: Story = {
  args: { children: "Flagship", variant: "dark" },
  parameters: { backgrounds: { default: "ink" } },
};
