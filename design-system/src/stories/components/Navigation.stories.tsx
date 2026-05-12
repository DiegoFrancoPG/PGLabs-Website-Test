import type { Meta, StoryObj } from "@storybook/react";
import { Navbar } from "@/components/custom/navbar";

const meta = {
  title: "Components/Navigation",
  component: Navbar,
  parameters: { layout: "padded", backgrounds: { default: "cream" } },
  tags: ["autodocs"],
} satisfies Meta<typeof Navbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithActiveItem: Story = {
  args: {
    items: [
      { label: "Home", href: "/", active: true },
      { label: "Services", href: "/services" },
      { label: "AI Readiness", href: "/ai-readiness" },
      { label: "About", href: "/about" },
    ],
  },
};
