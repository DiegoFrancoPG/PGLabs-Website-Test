import type { Meta, StoryObj } from "@storybook/react";
import { SectionHeading } from "@/components/custom/section-heading";

const meta = {
  title: "Components/SectionHeading",
  component: SectionHeading,
  parameters: { layout: "padded", backgrounds: { default: "white" } },
  tags: ["autodocs"],
  argTypes: {
    tone: { control: "select", options: ["light", "dark"] },
    align: { control: "select", options: ["left", "center"] },
    size: { control: "select", options: ["default", "lg"] },
  },
} satisfies Meta<typeof SectionHeading>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    eyebrow: "The problem we solve",
    title: "The bottleneck isn't talent, it's the system.",
    lede: "Newcomer populations are expanding faster than services can absorb, and human-only systems cannot keep pace with the need.",
  },
};

/** The deck often carries the emphasis on the second line. */
export const WithEmphasis: Story = {
  args: {
    eyebrow: "The economic imperative",
    title: (
      <>
        Migration isn&rsquo;t charity.
        <br />
        <em style={{ fontStyle: "italic", color: "#11739c" }}>It&rsquo;s math.</em>
      </>
    ),
    lede: "Roughly all of Canada's labour-force growth is now driven by immigration.",
  },
};

export const Centered: Story = {
  args: {
    eyebrow: "Our framework",
    title: "A phased approach to AI readiness",
    lede: "Four interconnected phases, from governance through to integration.",
    align: "center",
  },
};

export const OnInk: Story = {
  args: {
    eyebrow: "Your invitation",
    title: "Become part of something bigger than yourself.",
    lede: "A chance to leave a legacy: fund the infrastructure that turns displacement into contribution.",
    tone: "dark",
    size: "lg",
  },
  parameters: { backgrounds: { default: "ink" } },
  decorators: [
    (Story) => (
      <div style={{ backgroundColor: "#1a2230", padding: "64px" }}>
        <Story />
      </div>
    ),
  ],
};
