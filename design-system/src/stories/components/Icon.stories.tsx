import type { Meta, StoryObj } from "@storybook/react";
import {
  Shield,
  Globe,
  Brain,
  Users,
  Lightbulb,
  BarChart2,
  CheckCircle,
  AlertTriangle,
  ArrowRight,
  Mail,
} from "lucide-react";
import { IconCircle } from "@/components/custom/icon-circle";

function IconGallery() {
  const icons = [
    { Icon: Shield, label: "Shield" },
    { Icon: Globe, label: "Globe" },
    { Icon: Brain, label: "Brain" },
    { Icon: Users, label: "Users" },
    { Icon: Lightbulb, label: "Lightbulb" },
    { Icon: BarChart2, label: "BarChart2" },
    { Icon: CheckCircle, label: "CheckCircle" },
    { Icon: AlertTriangle, label: "AlertTriangle" },
    { Icon: ArrowRight, label: "ArrowRight" },
    { Icon: Mail, label: "Mail" },
  ];

  return (
    <div style={{ fontFamily: "Inter, sans-serif", padding: "32px" }}>
      <h2 style={{ fontFamily: "Space Grotesk", fontSize: "18px", fontWeight: 500, marginBottom: "24px", color: "#2c3436" }}>
        Standalone Icons (lucide-react)
      </h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "24px", marginBottom: "48px" }}>
        {icons.map(({ Icon, label }) => (
          <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
            <Icon size={24} color="#2c3436" />
            <span style={{ fontSize: "11px", color: "#636e72" }}>{label}</span>
          </div>
        ))}
      </div>

      <h2 style={{ fontFamily: "Space Grotesk", fontSize: "18px", fontWeight: 500, marginBottom: "24px", color: "#2c3436" }}>
        Icon in Container (IconCircle)
      </h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
        {(["orange", "blue", "gold", "purple"] as const).map((color) => (
          <div key={color} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
            <IconCircle color={color}><Shield size={18} /></IconCircle>
            <span style={{ fontSize: "11px", color: "#636e72" }}>{color}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const meta = {
  title: "Components/Icon",
  component: IconGallery,
  parameters: { layout: "padded", backgrounds: { default: "cream" } },
  tags: ["autodocs"],
} satisfies Meta<typeof IconGallery>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Standalone: Story = {};
