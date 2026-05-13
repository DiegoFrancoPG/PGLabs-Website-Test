import type { Meta, StoryObj } from "@storybook/react";
import { Footer } from "@/components/custom/footer";

const meta = {
  title: "Patterns/Footer",
  component: Footer,
  parameters: { layout: "fullscreen", backgrounds: { default: "dark-grey" } },
  tags: ["autodocs"],
} satisfies Meta<typeof Footer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CustomLinks: Story = {
  args: {
    links: [
      { label: "Services", href: "/services" },
      { label: "AI Readiness", href: "/ai-readiness" },
      { label: "Responsible AI", href: "/responsible-ai" },
      { label: "About", href: "/about" },
      { label: "Contact", href: "/contact" },
    ],
  },
};
