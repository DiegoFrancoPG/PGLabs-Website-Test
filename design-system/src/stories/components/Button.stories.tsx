import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

const meta = {
  title: "Components/Button",
  component: Button,
  parameters: { layout: "centered", backgrounds: { default: "cream" } },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["primary", "outline", "ghost", "cta", "secondary", "destructive", "link"],
    },
    size: { control: "select", options: ["sm", "default", "lg", "icon"] },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: { children: "Get Started", variant: "primary" },
};

export const Outline: Story = {
  args: { children: "Learn More", variant: "outline" },
};

export const Ghost: Story = {
  args: { children: "View All", variant: "ghost" },
  parameters: { backgrounds: { default: "dark-grey" } },
};

export const CTA: Story = {
  args: { children: "Schedule a Call", variant: "cta" },
};

export const WithIcon: Story = {
  args: { children: "Get Started", variant: "primary" },
  render: (args) => (
    <Button {...args}>
      <span>Get Started</span>
      <ArrowRight size={16} />
    </Button>
  ),
};

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center", padding: "24px", backgroundColor: "#2c3436", borderRadius: "16px" }}>
      <Button variant="primary">Primary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="cta">CTA</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="link">Link</Button>
      <Button variant="primary" disabled>Disabled</Button>
    </div>
  ),
  parameters: { backgrounds: { default: "dark-grey" } },
};

export const Sizes: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
      <Button variant="primary" size="sm">Small</Button>
      <Button variant="primary" size="default">Default</Button>
      <Button variant="primary" size="lg">Large</Button>
    </div>
  ),
};
