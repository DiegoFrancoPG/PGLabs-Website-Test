import type { Meta, StoryObj } from "@storybook/react";
import { MiniCard } from "@/components/custom/mini-card";

const meta = {
  title: "Components/MiniCard",
  component: MiniCard,
  parameters: { layout: "centered", backgrounds: { default: "white" } },
  tags: ["autodocs"],
  argTypes: {
    color: { control: "select", options: ["brand", "gold", "coral", "azure"] },
    tone: { control: "select", options: ["light", "dark"] },
  },
} satisfies Meta<typeof MiniCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    number: 1,
    title: "Your family migrated",
    description: "Go back far enough and every family arrived from somewhere.",
    color: "brand",
  },
};

/** Deck slide 2 — "Who counts as a migrant?" */
export const Stack: Story = {
  args: { title: "MiniCard" },
  render: () => (
    <div style={{ display: "flex", flexDirection: "column" as const, gap: "12px", width: "420px" }}>
      <MiniCard
        number={1}
        title="Your family migrated"
        description="Go back far enough and every family arrived from somewhere."
        color="brand"
      />
      <MiniCard
        number={2}
        title="Someone you love is a newcomer"
        description="A colleague, neighbour, or a partner — newcomers are all around you."
        color="gold"
      />
      <MiniCard
        number={3}
        title="Your city was built by immigrants"
        description="The people who built where you live came with little more than ambition."
        color="coral"
      />
    </div>
  ),
};

export const OnInk: Story = {
  args: { title: "MiniCard" },
  render: () => (
    <div
      style={{
        display: "flex",
        flexDirection: "column" as const,
        gap: "12px",
        width: "420px",
        padding: "32px",
        backgroundColor: "#1a2230",
      }}
    >
      <MiniCard
        tone="dark"
        number={1}
        title="Smart onboarding"
        description="Captures career history, credentials and preferences upfront."
        color="brand"
      />
      <MiniCard
        tone="dark"
        number={2}
        title="Skill mapping & job match"
        description="Interprets résumés against real labour-market demand."
        color="gold"
      />
    </div>
  ),
  parameters: { backgrounds: { default: "ink" } },
};
