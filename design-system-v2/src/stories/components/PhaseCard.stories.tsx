import type { Meta, StoryObj } from "@storybook/react";
import { PhaseCard } from "@/components/custom/phase-card";

const meta = {
  title: "Components/PhaseCard",
  component: PhaseCard,
  parameters: { layout: "centered", backgrounds: { default: "white" } },
  tags: ["autodocs"],
  argTypes: {
    color: { control: "select", options: ["brand", "gold", "coral", "azure"] },
    tone: { control: "select", options: ["light", "dark"] },
  },
} satisfies Meta<typeof PhaseCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    phase: "01",
    title: "Smart onboarding",
    description:
      "Captures career history, credentials and preferences upfront — guidance from day one.",
    color: "brand",
  },
};

/** Deck slide 23 — Welcome Coach 2.0, four steps across. */
export const AllPhases: Story = {
  args: { phase: "01", title: "Phase", description: "Description" },
  render: () => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 230px)", gap: "32px" }}>
      <PhaseCard
        phase="01"
        title="Smart onboarding"
        description="Captures career history, credentials and preferences upfront."
        color="brand"
      />
      <PhaseCard
        phase="02"
        title="Skill mapping & job match"
        description="Interprets résumés against real labour-market demand to surface reachable roles."
        color="gold"
      />
      <PhaseCard
        phase="03"
        title="Path comparison"
        description="Side-by-side routes by time, cost, location and earning potential."
        color="coral"
      />
      <PhaseCard
        phase="04"
        title="Job co-pilot"
        description="Jobs board, application tracker, AI interview coach and résumé tailor in one place."
        color="azure"
      />
    </div>
  ),
};

export const OnInk: Story = {
  args: { phase: "01", title: "Phase", description: "Description" },
  render: () => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, 240px)",
        gap: "32px",
        padding: "40px",
        backgroundColor: "#1a2230",
      }}
    >
      <PhaseCard
        tone="dark"
        phase="01"
        title="Smart onboarding"
        description="Captures career history, credentials and preferences upfront."
        color="brand"
      />
      <PhaseCard
        tone="dark"
        phase="02"
        title="Skill mapping & job match"
        description="Interprets résumés against real labour-market demand."
        color="gold"
      />
    </div>
  ),
  parameters: { backgrounds: { default: "ink" } },
};
