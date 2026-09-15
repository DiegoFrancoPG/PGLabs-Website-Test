import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

const meta = {
  title: "Components/Button",
  component: Button,
  parameters: { layout: "centered", backgrounds: { default: "white" } },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: [
        "primary",
        "secondary",
        "outline",
        "accent",
        "ghost",
        "subtle",
        "destructive",
        "link",
      ],
    },
    size: { control: "select", options: ["sm", "default", "lg", "icon"] },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { children: "Book a meeting", variant: "primary" } };
export const Secondary: Story = { args: { children: "Read the case", variant: "secondary" } };
export const Outline: Story = { args: { children: "Explore our work", variant: "outline" } };
export const Accent: Story = { args: { children: "Become a lead donor", variant: "accent" } };
export const Subtle: Story = { args: { children: "Download the brief", variant: "subtle" } };
export const Link: Story = { args: { children: "See the full report", variant: "link" } };

export const Ghost: Story = {
  args: { children: "View all partners", variant: "ghost" },
  parameters: { backgrounds: { default: "ink" } },
};

export const WithIcon: Story = {
  args: { children: "Book a meeting", variant: "primary" },
  render: (args) => (
    <Button {...args}>
      <span>Book a meeting</span>
      <ArrowRight size={16} />
    </Button>
  ),
};

export const AllVariants: Story = {
  args: { children: "Button" },
  render: () => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center", padding: "24px" }}>
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="accent">Accent</Button>
      <Button variant="subtle">Subtle</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="link">Link</Button>
      <Button variant="primary" disabled>
        Disabled
      </Button>
    </div>
  ),
};

export const OnInk: Story = {
  args: { children: "Button" },
  render: () => (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "12px",
        alignItems: "center",
        padding: "32px",
        backgroundColor: "#1a2230",
      }}
    >
      <Button variant="primary">Primary</Button>
      <Button variant="accent">Accent</Button>
      <Button variant="ghost">Ghost</Button>
    </div>
  ),
  parameters: { backgrounds: { default: "ink" } },
};

export const Sizes: Story = {
  args: { children: "Button" },
  render: () => (
    <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
      <Button variant="primary" size="sm">
        Small
      </Button>
      <Button variant="primary" size="default">
        Default
      </Button>
      <Button variant="primary" size="lg">
        Large
      </Button>
    </div>
  ),
};
