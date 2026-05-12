import type { Meta, StoryObj } from "@storybook/react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

function FormExample() {
  return (
    <div style={{ width: "480px", display: "flex", flexDirection: "column" as const, gap: "20px", padding: "32px", backgroundColor: "#fff", borderRadius: "16px", border: "1px solid rgba(0,0,0,0.06)" }}>
      <h2 style={{ fontFamily: "Space Grotesk", fontSize: "18px", fontWeight: 500, color: "#2c3436", margin: 0 }}>Get in Touch</h2>
      <div style={{ display: "flex", flexDirection: "column" as const, gap: "6px" }}>
        <Label htmlFor="name">Full Name</Label>
        <Input id="name" placeholder="Jane Smith" />
      </div>
      <div style={{ display: "flex", flexDirection: "column" as const, gap: "6px" }}>
        <Label htmlFor="email">Email Address</Label>
        <Input id="email" type="email" placeholder="jane@organization.org" />
      </div>
      <div style={{ display: "flex", flexDirection: "column" as const, gap: "6px" }}>
        <Label htmlFor="org">Organization</Label>
        <Input id="org" placeholder="Organization name" />
      </div>
      <div style={{ display: "flex", flexDirection: "column" as const, gap: "6px" }}>
        <Label htmlFor="message">Message</Label>
        <Textarea id="message" placeholder="Tell us about your AI readiness goals..." />
      </div>
      <Button variant="primary">Send Message</Button>
    </div>
  );
}

const meta = {
  title: "Components/Form",
  component: FormExample,
  parameters: { layout: "centered", backgrounds: { default: "cream" } },
  tags: ["autodocs"],
} satisfies Meta<typeof FormExample>;

export default meta;
type Story = StoryObj<typeof meta>;
export const ContactForm: Story = {};

export const InputVariants: Story = {
  render: () => (
    <div style={{ width: "360px", display: "flex", flexDirection: "column" as const, gap: "12px" }}>
      <Input placeholder="Default input" />
      <Input placeholder="Disabled input" disabled />
      <Input type="email" placeholder="Email input" />
      <Textarea placeholder="Textarea field" />
    </div>
  ),
};
