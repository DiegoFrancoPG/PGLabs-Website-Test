import type { Meta, StoryObj } from "@storybook/react";
import { Eyebrow } from "@/components/custom/eyebrow";

const meta = {
  title: "Components/Eyebrow",
  component: Eyebrow,
  parameters: { layout: "centered", backgrounds: { default: "white" } },
  tags: ["autodocs"],
  argTypes: {
    variant: { control: "select", options: ["default", "brand", "gold", "white"] },
    rule: { control: "boolean" },
  },
} satisfies Meta<typeof Eyebrow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { children: "The global picture", variant: "default" } };
export const Brand: Story = { args: { children: "Our flagship", variant: "brand" } };
export const Gold: Story = { args: { children: "The economics", variant: "gold" } };
export const NoRule: Story = { args: { children: "Who we are", variant: "brand", rule: false } };

export const White: Story = {
  args: { children: "Where it leads", variant: "white" },
  parameters: { backgrounds: { default: "ink" } },
};

export const AllVariants: Story = {
  args: { children: "Eyebrow" },
  render: () => (
    <div style={{ display: "flex", flexDirection: "column" as const, gap: "20px" }}>
      <Eyebrow variant="default">The global picture</Eyebrow>
      <Eyebrow variant="brand">Our flagship</Eyebrow>
      <Eyebrow variant="gold">The economics</Eyebrow>
      <Eyebrow variant="brand" rule={false}>
        Who we are
      </Eyebrow>
      <div style={{ backgroundColor: "#1a2230", padding: "20px", borderRadius: "3px" }}>
        <Eyebrow variant="white">Where it leads</Eyebrow>
      </div>
    </div>
  ),
};
