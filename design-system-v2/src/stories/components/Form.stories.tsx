import type { Meta, StoryObj } from "@storybook/react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const field = { display: "flex", flexDirection: "column" as const, gap: "8px" };

function FormExample() {
  return (
    <div
      style={{
        width: "520px",
        display: "flex",
        flexDirection: "column" as const,
        gap: "22px",
        padding: "40px",
        backgroundColor: "#fff",
        borderRadius: "3px",
        border: "1px solid #c9d4e2",
      }}
    >
      <h2
        style={{
          fontFamily: "'Playfair Display', Georgia, serif",
          fontSize: "28px",
          fontWeight: 600,
          letterSpacing: "-0.015em",
          color: "#1a2230",
          margin: 0,
        }}
      >
        Start a conversation
      </h2>
      <div style={field}>
        <Label htmlFor="name">Full name</Label>
        <Input id="name" placeholder="Jane Smith" />
      </div>
      <div style={field}>
        <Label htmlFor="email">Email address</Label>
        <Input id="email" type="email" placeholder="jane@organization.org" />
      </div>
      <div style={field}>
        <Label htmlFor="org">Organization</Label>
        <Input id="org" placeholder="Organization name" />
      </div>
      <div style={field}>
        <Label htmlFor="message">Message</Label>
        <Textarea id="message" placeholder="Tell us what you're trying to build…" />
      </div>
      <Button variant="primary" size="lg">
        Send message
      </Button>
    </div>
  );
}

const meta = {
  title: "Components/Form",
  component: FormExample,
  parameters: { layout: "centered", backgrounds: { default: "surface" } },
  tags: ["autodocs"],
} satisfies Meta<typeof FormExample>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ContactForm: Story = {};

export const InputStates: Story = {
  render: () => (
    <div style={{ width: "400px", display: "flex", flexDirection: "column" as const, gap: "14px" }}>
      <Input placeholder="Default input" />
      <Input placeholder="Disabled input" disabled />
      <Input type="email" defaultValue="jane@organization.org" />
      <Textarea placeholder="Textarea field" />
    </div>
  ),
};
