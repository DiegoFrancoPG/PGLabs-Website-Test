import type { Meta, StoryObj } from "@storybook/react";

const spacingScale = [
  { token: "1", px: "4px" }, { token: "1.5", px: "6px" }, { token: "2", px: "8px" },
  { token: "3", px: "12px" }, { token: "3.5", px: "14px" }, { token: "4", px: "16px" },
  { token: "5", px: "20px" }, { token: "6", px: "24px" }, { token: "7", px: "28px" },
  { token: "8", px: "32px" }, { token: "10", px: "40px" }, { token: "12", px: "48px" },
  { token: "16", px: "64px" }, { token: "20", px: "80px" }, { token: "30", px: "120px" },
  { token: "32", px: "128px" },
];

function SpacingDisplay() {
  return (
    <div style={{ fontFamily: "Inter, sans-serif", padding: "32px", backgroundColor: "#fcfaf7", minHeight: "100vh" }}>
      <h1 style={{ fontFamily: "Space Grotesk", fontSize: "32px", fontWeight: 500, marginBottom: "8px", color: "#2c3436" }}>Spacing</h1>
      <p style={{ color: "#636e72", marginBottom: "48px" }}>8px base unit spacing scale</p>
      <div style={{ display: "flex", flexDirection: "column" as const, gap: "12px" }}>
        {spacingScale.map((item) => (
          <div key={item.token} style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div style={{ width: "60px", fontSize: "11px", color: "#b2bec3", fontFamily: "monospace" }}>space-{item.token}</div>
            <div style={{ width: "40px", fontSize: "13px", color: "#636e72" }}>{item.px}</div>
            <div style={{ width: item.px, height: "24px", backgroundColor: "#e87964", borderRadius: "4px", minWidth: "2px" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

const meta = {
  title: "Foundations/Spacing",
  component: SpacingDisplay,
  parameters: { layout: "fullscreen", backgrounds: { default: "cream" } },
  tags: ["autodocs"],
} satisfies Meta<typeof SpacingDisplay>;

export default meta;
type Story = StoryObj<typeof meta>;
export const AllSpacing: Story = {};
