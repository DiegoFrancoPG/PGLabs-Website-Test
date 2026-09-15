import type { Meta, StoryObj } from "@storybook/react";
import { Navbar } from "@/components/custom/navbar";

const meta = {
  title: "Components/Navigation",
  component: Navbar,
  parameters: { layout: "fullscreen", backgrounds: { default: "white" } },
  tags: ["autodocs"],
  argTypes: {
    tone: { control: "select", options: ["light", "dark"] },
  },
} satisfies Meta<typeof Navbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithActiveItem: Story = {
  args: {
    items: [
      { label: "Services", href: "/services", active: true },
      { label: "Our Work", href: "/work" },
      { label: "AI Readiness", href: "/ai-readiness" },
      { label: "About", href: "/about" },
    ],
  },
};

export const OnInk: Story = {
  args: {
    tone: "dark",
    items: [
      { label: "Services", href: "/services" },
      { label: "Our Work", href: "/work", active: true },
      { label: "AI Readiness", href: "/ai-readiness" },
      { label: "About", href: "/about" },
    ],
  },
  parameters: { backgrounds: { default: "ink" } },
};
