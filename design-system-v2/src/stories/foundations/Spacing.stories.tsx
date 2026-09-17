import type { Meta, StoryObj } from "@storybook/react";

const spacingScale = [
  { token: "1", px: "4px" },
  { token: "2", px: "8px" },
  { token: "3", px: "12px" },
  { token: "4", px: "16px" },
  { token: "4.5", px: "18px" },
  { token: "5", px: "20px" },
  { token: "6", px: "24px" },
  { token: "8", px: "32px" },
  { token: "10", px: "40px" },
  { token: "12", px: "48px" },
  { token: "13", px: "52px" },
  { token: "15", px: "60px" },
  { token: "16", px: "64px" },
  { token: "18", px: "72px" },
  { token: "22", px: "88px" },
  { token: "26", px: "104px" },
  { token: "30", px: "120px" },
  { token: "34", px: "136px" },
  { token: "40", px: "160px" },
];

const measures = [
  { token: "max-w-measure", value: "56ch", note: "Stat captions, short copy" },
  { token: "max-w-prose", value: "68ch", note: "Long-form body copy" },
  { token: "max-w-content", value: "1200px", note: "Standard page gutter" },
  { token: "max-w-wide", value: "1360px", note: "Full-bleed editorial spreads" },
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

function SpacingDisplay() {
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
        Spacing & measure
      </h1>
      <p style={{ color: "#667083", marginBottom: "56px", maxWidth: "68ch" }}>
        A 4px base unit, with generous named steps for the tall section rhythm the
        editorial layout needs.
      </p>

      <h2 style={sectionLabel}>Spacing scale</h2>
      <div style={{ display: "flex", flexDirection: "column" as const, gap: "10px", marginBottom: "56px" }}>
        {spacingScale.map((item) => (
          <div key={item.token} style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div style={{ width: "76px", fontSize: "11px", color: "#9daac0", fontFamily: "monospace" }}>
              space-{item.token}
            </div>
            <div style={{ width: "48px", fontSize: "13px", color: "#667083" }}>{item.px}</div>
            <div
              style={{
                width: item.px,
                height: "20px",
                backgroundColor: "#11739c",
                borderRadius: "2px",
                minWidth: "2px",
              }}
            />
          </div>
        ))}
      </div>

      <h2 style={sectionLabel}>Measure</h2>
      <div style={{ display: "flex", flexDirection: "column" as const, gap: "14px" }}>
        {measures.map((m) => (
          <div key={m.token} style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div style={{ width: "150px", fontSize: "11px", color: "#9daac0", fontFamily: "monospace" }}>
              {m.token}
            </div>
            <div style={{ width: "72px", fontSize: "13px", color: "#1a2230", fontWeight: 600 }}>
              {m.value}
            </div>
            <div style={{ fontSize: "13px", color: "#667083" }}>{m.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const meta = {
  title: "Foundations/Spacing",
  component: SpacingDisplay,
  parameters: { layout: "fullscreen", backgrounds: { default: "white" } },
  tags: ["autodocs"],
} satisfies Meta<typeof SpacingDisplay>;

export default meta;
type Story = StoryObj<typeof meta>;
export const AllSpacing: Story = {};
