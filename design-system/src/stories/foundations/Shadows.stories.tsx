import type { Meta, StoryObj } from "@storybook/react";

const shadows = [
  { name: "xs", value: "0 1px 4px rgba(0,0,0,0.06)", label: "Extra Small", usage: "Mini cards" },
  { name: "sm", value: "0 2px 12px rgba(0,0,0,0.05)", label: "Small", usage: "Navbar, containers" },
  { name: "nav", value: "0 2px 12px rgba(0,0,0,0.2)", label: "Nav", usage: "Navigation bar" },
  { name: "glow-orange", value: "0 0 0 3px rgba(232,121,100,0.25)", label: "Glow Orange", usage: "Focus states, highlights" },
  { name: "glow-blue", value: "0 0 0 3px rgba(100,160,180,0.25)", label: "Glow Blue", usage: "Timeline step - blue" },
  { name: "glow-gold", value: "0 0 0 3px rgba(212,167,106,0.25)", label: "Glow Gold", usage: "Timeline step - gold" },
];

const radii = [
  { name: "sm", value: "6px" }, { name: "DEFAULT", value: "8px" },
  { name: "md", value: "12px" }, { name: "lg", value: "16px" },
  { name: "xl", value: "24px" }, { name: "full", value: "9999px" },
];

function ShadowsDisplay() {
  return (
    <div style={{ fontFamily: "Inter, sans-serif", padding: "32px", backgroundColor: "#fcfaf7", minHeight: "100vh" }}>
      <h1 style={{ fontFamily: "Space Grotesk", fontSize: "32px", fontWeight: 500, marginBottom: "8px", color: "#2c3436" }}>Shadows & Radius</h1>
      <p style={{ color: "#636e72", marginBottom: "48px" }}>Elevation and rounding tokens</p>
      <h2 style={{ fontSize: "11px", fontWeight: 500, letterSpacing: "1.1px", textTransform: "uppercase" as const, color: "#b2bec3", marginBottom: "24px" }}>BOX SHADOWS</h2>
      <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" as const, marginBottom: "48px" }}>
        {shadows.map((s) => (
          <div key={s.name} style={{ textAlign: "center" as const }}>
            <div style={{ width: "140px", height: "80px", borderRadius: "12px", backgroundColor: "#fff", boxShadow: s.value, marginBottom: "12px" }} />
            <p style={{ fontSize: "13px", fontWeight: 600, color: "#2c3436", margin: 0 }}>{s.label}</p>
            <p style={{ fontSize: "11px", color: "#636e72", margin: "2px 0 0" }}>{s.usage}</p>
            <p style={{ fontSize: "11px", color: "#b2bec3", margin: "2px 0 0", fontFamily: "monospace" }}>shadow-{s.name}</p>
          </div>
        ))}
      </div>
      <h2 style={{ fontSize: "11px", fontWeight: 500, letterSpacing: "1.1px", textTransform: "uppercase" as const, color: "#b2bec3", marginBottom: "24px" }}>BORDER RADIUS</h2>
      <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" as const }}>
        {radii.map((r) => (
          <div key={r.name} style={{ textAlign: "center" as const }}>
            <div style={{ width: "80px", height: "80px", backgroundColor: "#e87964", borderRadius: r.value, marginBottom: "12px" }} />
            <p style={{ fontSize: "13px", fontWeight: 600, color: "#2c3436", margin: 0 }}>{r.name}</p>
            <p style={{ fontSize: "11px", color: "#636e72", margin: "2px 0 0" }}>{r.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

const meta = {
  title: "Foundations/Shadows & Radius",
  component: ShadowsDisplay,
  parameters: { layout: "fullscreen", backgrounds: { default: "cream" } },
  tags: ["autodocs"],
} satisfies Meta<typeof ShadowsDisplay>;

export default meta;
type Story = StoryObj<typeof meta>;
export const AllShadowsAndRadius: Story = {};
