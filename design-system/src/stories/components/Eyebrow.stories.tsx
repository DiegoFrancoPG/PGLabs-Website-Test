import type { Meta, StoryObj } from "@storybook/react";
import { Eyebrow } from "@/components/custom/eyebrow";

const meta = {
  title: "Components/Eyebrow",
  component: Eyebrow,
  parameters: { layout: "centered", backgrounds: { default: "cream" } },
  tags: ["autodocs"],
  argTypes: {
    variant: { control: "select", options: ["default", "coral", "white"] },
  },
} satisfies Meta<typeof Eyebrow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { children: "Our Services", variant: "default" } };
export const Coral: Story = { args: { children: "Our Approach", variant: "coral" } };
export const White: Story = {
  args: { children: "Why PG Labs", variant: "white" },
  parameters: { backgrounds: { default: "dark-grey" } },
};

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column" as const, gap: "16px" }}>
      <Eyebrow variant="default">Default Eyebrow</Eyebrow>
      <Eyebrow variant="coral">Coral Eyebrow</Eyebrow>
      <div style={{ backgroundColor: "#2c3436", padding: "16px", borderRadius: "8px" }}>
        <Eyebrow variant="white">White Eyebrow</Eyebrow>
      </div>
    </div>
  ),
};
