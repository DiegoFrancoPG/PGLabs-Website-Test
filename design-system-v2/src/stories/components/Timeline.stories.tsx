import type { Meta, StoryObj } from "@storybook/react";
import { Timeline } from "@/components/custom/timeline";

const meta = {
  title: "Components/Timeline",
  component: Timeline,
  parameters: { layout: "centered", backgrounds: { default: "white" } },
  tags: ["autodocs"],
  argTypes: {
    tone: { control: "select", options: ["light", "dark"] },
  },
} satisfies Meta<typeof Timeline>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Deck slide 16 — "Our journey: 14 years". */
const journey = [
  {
    label: "2012",
    title: "PeaceGeeks is born",
    description: "A Vancouver volunteer collective building technology for peace.",
    color: "brand" as const,
  },
  {
    label: "2015–2018",
    title: "Services Advisor launches",
    description:
      "Built with UNHCR in Jordan, then deployed in Turkey, Iraq and Malaysia.",
    color: "azure" as const,
  },
  {
    label: "2017",
    title: "Google.org Impact Challenge",
    description: "Award funding kicks off development of Arrival Advisor.",
    color: "gold" as const,
  },
  {
    label: "2021",
    title: "UN Intercultural Innovation Award",
    description:
      "Recognition alongside work with Accenture, BMW and UNAOC.",
    color: "coral" as const,
  },
  {
    label: "2025",
    title: "Healthcare Coach launches",
    description: "Market expansion into industry-specific credential pathways.",
    color: "brand" as const,
  },
];

export const Default: Story = {
  args: { items: journey },
};

export const OnInk: Story = {
  args: { items: journey, tone: "dark" },
  parameters: { backgrounds: { default: "ink" } },
  decorators: [
    (Story) => (
      <div style={{ backgroundColor: "#1a2230", padding: "48px" }}>
        <Story />
      </div>
    ),
  ],
};
