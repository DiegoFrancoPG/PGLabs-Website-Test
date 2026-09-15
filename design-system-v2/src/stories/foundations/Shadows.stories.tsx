import type { Meta, StoryObj } from "@storybook/react";

const shadows = [
  { name: "xs", value: "0 1px 2px rgba(26,34,48,0.06)", label: "Extra small", usage: "Mini cards, chips" },
  { name: "sm", value: "0 2px 8px rgba(26,34,48,0.07)", label: "Small", usage: "Hover lift on buttons" },
  { name: "md", value: "0 6px 20px rgba(26,34,48,0.09)", label: "Medium", usage: "Raised panels" },
  { name: "lg", value: "0 16px 44px rgba(26,34,48,0.12)", label: "Large", usage: "Overlays, dialogs" },
  { name: "nav", value: "0 1px 0 rgba(201,212,226,1)", label: "Nav rule", usage: "Masthead hairline" },
  { name: "ring-brand", value: "0 0 0 3px rgba(58,168,160,0.28)", label: "Ring brand", usage: "Focus states" },
  { name: "ring-gold", value: "0 0 0 3px rgba(232,163,61,0.28)", label: "Ring gold", usage: "Gold emphasis" },
  { name: "ring-coral", value: "0 0 0 3px rgba(226,98,74,0.28)", label: "Ring coral", usage: "Destructive focus" },
];

const radii = [
  { name: "none", value: "0" },
  { name: "sm", value: "2px" },
  { name: "DEFAULT", value: "3px" },
  { name: "md", value: "4px" },
  { name: "lg", value: "6px" },
  { name: "xl", value: "10px" },
  { name: "full", value: "9999px" },
];

const BODY = "'Open Sans', sans-serif";
const DISPLAY = "'Playfair Display', Georgia, serif";

const sectionLabel = {
  fontSize: "12px",
  fontWeight: 600,
  letterSpacing: "0.14em",
  textTransform: "uppercase" as const,
  color: "#8595ab",
  marginBottom: "24px",
};

function ShadowsDisplay() {
  return (
    <div style={{ fontFamily: BODY, padding: "40px", backgroundColor: "#ffffff", minHeight: "100vh" }}>
      <h1
        style={{
          fontFamily: DISPLAY,
          fontSize: "40px",
          fontWeight: 600,
          letterSpacing: "-0.02em",
          marginBottom: "8px",
          color: "#1a2230",
        }}
      >
        Elevation & radius
      </h1>
      <p style={{ color: "#667083", marginBottom: "56px", maxWidth: "68ch" }}>
        Shadows are tinted with ink navy rather than neutral black, so elevation
        reads cool. Radii are near-square — the deck sets type on a grid, not in
        pills.
      </p>

      <h2 style={sectionLabel}>Box shadows</h2>
      <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" as const, marginBottom: "56px" }}>
        {shadows.map((s) => (
          <div key={s.name} style={{ width: "150px" }}>
            <div
              style={{
                width: "100%",
                height: "84px",
                borderRadius: "3px",
                backgroundColor: "#fff",
                boxShadow: s.value,
                border: "1px solid rgba(201,212,226,0.5)",
                marginBottom: "12px",
              }}
            />
            <p style={{ fontSize: "14px", fontWeight: 600, color: "#1a2230", margin: 0 }}>{s.label}</p>
            <p style={{ fontSize: "12px", color: "#667083", margin: "2px 0 0" }}>{s.usage}</p>
            <p style={{ fontSize: "11px", color: "#9daac0", margin: "2px 0 0", fontFamily: "monospace" }}>
              shadow-{s.name}
            </p>
          </div>
        ))}
      </div>

      <h2 style={sectionLabel}>Border radius</h2>
      <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" as const }}>
        {radii.map((r) => (
          <div key={r.name} style={{ textAlign: "center" as const }}>
            <div
              style={{
                width: "84px",
                height: "84px",
                backgroundColor: "#11739c",
                borderRadius: r.value,
                marginBottom: "12px",
              }}
            />
            <p style={{ fontSize: "13px", fontWeight: 600, color: "#1a2230", margin: 0 }}>{r.name}</p>
            <p style={{ fontSize: "12px", color: "#667083", margin: "2px 0 0" }}>{r.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

const meta = {
  title: "Foundations/Shadows & Radius",
  component: ShadowsDisplay,
  parameters: { layout: "fullscreen", backgrounds: { default: "white" } },
  tags: ["autodocs"],
} satisfies Meta<typeof ShadowsDisplay>;

export default meta;
type Story = StoryObj<typeof meta>;
export const AllShadowsAndRadius: Story = {};
