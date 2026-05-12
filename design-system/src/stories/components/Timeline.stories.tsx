import type { Meta, StoryObj } from "@storybook/react";
import { Timeline } from "@/components/custom/timeline";

const meta = {
  title: "Components/Timeline",
  component: Timeline,
  parameters: { layout: "centered", backgrounds: { default: "cream" } },
  tags: ["autodocs"],
} satisfies Meta<typeof Timeline>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    items: [
      { label: "Week 1–2", title: "Discovery & Scoping", description: "Stakeholder interviews, data landscape review, and readiness baseline.", color: "blue" },
      { label: "Week 3–4", title: "Assessment & Analysis", description: "Gap analysis across governance, data, and technical dimensions.", color: "orange" },
      { label: "Week 5–6", title: "Roadmap Development", description: "Prioritized recommendations and phased implementation plan.", color: "gold" },
    ],
  },
};
