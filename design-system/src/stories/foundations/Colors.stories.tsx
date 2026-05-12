import type { Meta, StoryObj } from "@storybook/react";

const colorGroups = [
  {
    name: "Brand",
    tokens: [
      { name: "brand-orange", value: "#e87964", label: "Orange" },
      { name: "brand-cream", value: "#fcfaf7", label: "Cream", border: true },
      { name: "brand-dark-grey", value: "#2c3436", label: "Dark Grey" },
      { name: "brand-dark-blue", value: "#131a2c", label: "Dark Blue" },
    ],
  },
  {
    name: "Accent",
    tokens: [
      { name: "accent-blue", value: "#64a0b4", label: "Blue" },
      { name: "accent-gold", value: "#d4a76a", label: "Gold" },
      { name: "accent-purple", value: "#a78bfa", label: "Purple" },
    ],
  },
  {
    name: "Neutral",
    tokens: [
      { name: "neutral-body", value: "#636e72", label: "Body" },
      { name: "neutral-muted", value: "#b2bec3", label: "Muted" },
    ],
  },
];

function ColorsDisplay() {
  return (
    <div style={{ fontFamily: "Inter, sans-serif", padding: "32px", backgroundColor: "#fcfaf7", minHeight: "100vh" }}>
      <h1 style={{ fontFamily: "Space Grotesk", fontSize: "32px", fontWeight: 500, marginBottom: "8px", color: "#2c3436" }}>Color Tokens</h1>
      <p style={{ color: "#636e72", marginBottom: "48px" }}>The PGLabs brand color palette</p>
      {colorGroups.map((group) => (
        <div key={group.name} style={{ marginBottom: "40px" }}>
          <h2 style={{ fontFamily: "Space Grotesk", fontWeight: 500, color: "#2c3436", marginBottom: "20px", textTransform: "uppercase" as const, letterSpacing: "1.1px", fontSize: "11px" }}>{group.name}</h2>
          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" as const }}>
            {group.tokens.map((token) => (
              <div key={token.name} style={{ width: "160px" }}>
                <div
                  style={{
                    width: "100%",
                    height: "80px",
                    borderRadius: "12px",
                    backgroundColor: token.value,
                    border: token.border ? "1px solid rgba(0,0,0,0.1)" : "none",
                    marginBottom: "8px",
                  }}
                />
                <p style={{ fontSize: "13px", fontWeight: 600, color: "#2c3436", margin: 0 }}>{token.label}</p>
                <p style={{ fontSize: "11px", color: "#636e72", margin: "2px 0 0" }}>{token.value}</p>
                <p style={{ fontSize: "11px", color: "#b2bec3", margin: "2px 0 0", fontFamily: "monospace" }}>{token.name}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const meta = {
  title: "Foundations/Colors",
  component: ColorsDisplay,
  parameters: {
    layout: "fullscreen",
    backgrounds: { default: "cream" },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ColorsDisplay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllColors: Story = {};
