import type { Meta, StoryObj } from "@storybook/react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconCircle } from "@/components/custom/icon-circle";
import { Shield, Globe } from "lucide-react";

const meta = {
  title: "Components/Card",
  component: Card,
  parameters: { layout: "centered", backgrounds: { default: "white" } },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: [
        "default",
        "surface",
        "plain",
        "ruled",
        "dark",
        "dark-ruled",
        "mini",
        "phase",
        "quote",
      ],
    },
    accent: { control: "select", options: ["none", "brand", "gold", "coral", "azure"] },
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Card style={{ width: "340px" }}>
      <CardHeader>
        <IconCircle color="brand">
          <Shield size={18} />
        </IconCircle>
        <CardTitle>Responsible AI design</CardTitle>
      </CardHeader>
      <CardContent>
        <CardDescription>
          Embed ethical principles and accountability into every stage of AI
          system development.
        </CardDescription>
      </CardContent>
      <CardFooter>
        <Button variant="link" size="sm">
          Learn more
        </Button>
      </CardFooter>
    </Card>
  ),
};

export const WithAccentRule: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
      {(["brand", "gold", "coral", "azure"] as const).map((accent) => (
        <Card key={accent} accent={accent} style={{ width: "220px" }}>
          <CardTitle style={{ textTransform: "capitalize" }}>{accent}</CardTitle>
          <CardDescription>Keyline sits directly above the content.</CardDescription>
        </Card>
      ))}
    </div>
  ),
};

export const Ruled: Story = {
  render: () => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 220px)", gap: "32px" }}>
      <Card variant="ruled">
        <CardTitle>Immigration-driven growth</CardTitle>
        <CardDescription>
          Newcomer populations are expanding faster than services can absorb.
        </CardDescription>
      </Card>
      <Card variant="ruled">
        <CardTitle>Capacity pressure</CardTitle>
        <CardDescription>
          Settlement organizations are stretched thin and chronically
          under-resourced.
        </CardDescription>
      </Card>
      <Card variant="ruled">
        <CardTitle>Scaling challenges</CardTitle>
        <CardDescription>
          Human-only systems simply cannot keep pace with the need.
        </CardDescription>
      </Card>
    </div>
  ),
};

export const Quote: Story = {
  render: () => (
    <Card variant="quote" style={{ width: "520px" }}>
      <p
        style={{
          fontFamily: "'Playfair Display', Georgia, serif",
          fontSize: "28px",
          fontWeight: 600,
          letterSpacing: "-0.015em",
          lineHeight: 1.22,
          color: "#1a2230",
          margin: 0,
        }}
      >
        Talent is universally distributed. But opportunity is not.
      </p>
      <span
        style={{
          fontFamily: "'Open Sans', sans-serif",
          fontSize: "12px",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "#8595ab",
          marginTop: "20px",
        }}
      >
        — PeaceGeeks
      </span>
    </Card>
  ),
};

export const OnInk: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "16px", padding: "32px", backgroundColor: "#1a2230" }}>
      <Card variant="dark" style={{ width: "300px" }}>
        <CardHeader>
          <IconCircle color="brand">
            <Globe size={18} />
          </IconCircle>
          <CardTitle style={{ color: "#fff" }}>Global footprint</CardTitle>
        </CardHeader>
        <CardContent>
          <CardDescription style={{ color: "rgba(255,255,255,0.7)" }}>
            Deployed for displaced communities across South Sudan, Uganda, Jordan,
            Turkey, Iraq and Malaysia.
          </CardDescription>
        </CardContent>
      </Card>
      <Card variant="dark-ruled" style={{ width: "300px" }}>
        <CardTitle style={{ color: "#fff" }}>Ethical AI as enabler</CardTitle>
        <CardDescription style={{ color: "rgba(255,255,255,0.7)" }}>
          What took years of in-country relationship-building can now be localized
          in months.
        </CardDescription>
      </Card>
    </div>
  ),
  parameters: { backgrounds: { default: "ink" } },
};

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", padding: "24px" }}>
      <Card variant="default" style={{ width: "200px" }}>
        <CardTitle>Default</CardTitle>
        <CardDescription>White with a hairline border.</CardDescription>
      </Card>
      <Card variant="surface" style={{ width: "200px" }}>
        <CardTitle>Surface</CardTitle>
        <CardDescription>Cool grey section fill.</CardDescription>
      </Card>
      <Card variant="ruled" style={{ width: "200px" }}>
        <CardTitle>Ruled</CardTitle>
        <CardDescription>Borderless editorial column.</CardDescription>
      </Card>
    </div>
  ),
};
