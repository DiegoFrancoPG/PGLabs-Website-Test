import type { Meta, StoryObj } from "@storybook/react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shield, Globe } from "lucide-react";
import { IconCircle } from "@/components/custom/icon-circle";

const meta = {
  title: "Components/Card",
  component: Card,
  parameters: { layout: "centered", backgrounds: { default: "cream" } },
  tags: ["autodocs"],
  argTypes: {
    variant: { control: "select", options: ["default", "white", "muted", "orange", "dark", "mini", "phase", "risk", "audience"] },
    accent: { control: "select", options: ["none", "orange", "blue", "gold"] },
    shadow: { control: "select", options: ["none", "sm"] },
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Card style={{ width: "320px" }}>
      <CardHeader>
        <IconCircle color="orange"><Shield size={18} /></IconCircle>
        <CardTitle>Responsible AI Design</CardTitle>
      </CardHeader>
      <CardContent>
        <CardDescription>Embed ethical principles and accountability into every stage of AI system development.</CardDescription>
      </CardContent>
      <CardFooter>
        <Button variant="cta" size="sm">Learn More</Button>
      </CardFooter>
    </Card>
  ),
};

export const WithAccent: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
      {(["orange", "blue", "gold"] as const).map((accent) => (
        <Card key={accent} accent={accent} style={{ width: "240px" }}>
          <CardTitle>{accent.charAt(0).toUpperCase() + accent.slice(1)} Accent</CardTitle>
          <CardDescription>Card with {accent} accent line at top.</CardDescription>
        </Card>
      ))}
    </div>
  ),
};

export const DarkVariant: Story = {
  render: () => (
    <Card variant="dark" style={{ width: "320px" }}>
      <CardHeader>
        <IconCircle color="blue"><Globe size={18} /></IconCircle>
        <CardTitle style={{ color: "#fff" }}>Funder Alignment</CardTitle>
      </CardHeader>
      <CardContent>
        <CardDescription style={{ color: "rgba(255,255,255,0.6)" }}>Align AI initiatives with funding priorities and reporting requirements.</CardDescription>
      </CardContent>
    </Card>
  ),
  parameters: { backgrounds: { default: "dark-grey" } },
};

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", padding: "24px" }}>
      <Card variant="default" style={{ width: "200px" }}><CardTitle>Default</CardTitle><CardDescription>Cream background card</CardDescription></Card>
      <Card variant="white" style={{ width: "200px" }}><CardTitle>White</CardTitle><CardDescription>White background card</CardDescription></Card>
      <Card variant="muted" style={{ width: "200px" }}><CardTitle>Muted</CardTitle><CardDescription>Muted grey background card</CardDescription></Card>
      <Card variant="orange" style={{ width: "200px" }}>
        <CardTitle style={{ color: "#fff" }}>Orange</CardTitle>
        <CardDescription style={{ color: "rgba(255,255,255,0.75)" }}>Brand orange background card</CardDescription>
      </Card>
      <Card variant="phase" style={{ width: "200px" }}>
        <div style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: "#64a0b4", marginBottom: "8px" }} />
        <CardTitle style={{ fontSize: "19px" }}>Phase Card</CardTitle>
        <CardDescription>Centered phase card</CardDescription>
      </Card>
    </div>
  ),
};

export const WithShadow: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", padding: "24px" }}>
      <Card variant="white" shadow="none" style={{ width: "220px" }}>
        <CardTitle>No Shadow</CardTitle>
        <CardDescription>Default — no elevation</CardDescription>
      </Card>
      <Card variant="white" shadow="sm" style={{ width: "220px" }}>
        <CardTitle>Shadow sm</CardTitle>
        <CardDescription>Small shadow for subtle elevation</CardDescription>
      </Card>
    </div>
  ),
};
