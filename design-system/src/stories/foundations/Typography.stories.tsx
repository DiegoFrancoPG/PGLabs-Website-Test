import type { Meta, StoryObj } from "@storybook/react";

function TypographyDisplay() {
  return (
    <div style={{ fontFamily: "Inter, sans-serif", padding: "32px", backgroundColor: "#fcfaf7", minHeight: "100vh", color: "#2c3436" }}>
      <h1 style={{ fontFamily: "Space Grotesk", fontSize: "32px", fontWeight: 500, marginBottom: "8px" }}>Typography</h1>
      <p style={{ color: "#636e72", marginBottom: "48px" }}>Type scale and font families</p>

      <section style={{ marginBottom: "48px" }}>
        <h2 style={{ fontSize: "11px", fontWeight: 500, letterSpacing: "1.1px", textTransform: "uppercase" as const, color: "#b2bec3", marginBottom: "24px" }}>FONT FAMILIES</h2>
        <div style={{ display: "flex", gap: "40px", flexWrap: "wrap" as const }}>
          <div>
            <p style={{ fontSize: "11px", color: "#b2bec3", marginBottom: "8px" }}>DISPLAY — Space Grotesk</p>
            <p style={{ fontFamily: "Space Grotesk", fontSize: "32px", fontWeight: 500 }}>Aa Bb Cc 123</p>
            <p style={{ fontFamily: "Space Grotesk", fontSize: "15px", color: "#636e72" }}>Light Regular Medium Semibold Bold</p>
          </div>
          <div>
            <p style={{ fontSize: "11px", color: "#b2bec3", marginBottom: "8px" }}>BODY — Inter</p>
            <p style={{ fontFamily: "Inter", fontSize: "32px", fontWeight: 400 }}>Aa Bb Cc 123</p>
            <p style={{ fontFamily: "Inter", fontSize: "15px", color: "#636e72" }}>Light Regular Medium Semibold Bold</p>
          </div>
        </div>
      </section>

      <section style={{ marginBottom: "48px" }}>
        <h2 style={{ fontSize: "11px", fontWeight: 500, letterSpacing: "1.1px", textTransform: "uppercase" as const, color: "#b2bec3", marginBottom: "24px" }}>TYPE SCALE</h2>
        <div style={{ display: "flex", flexDirection: "column" as const, gap: "24px", borderLeft: "2px solid rgba(0,0,0,0.06)", paddingLeft: "24px" }}>
          {[
            { label: "H1 Large", font: "Space Grotesk", size: "52px", weight: 500, tracking: "-1.5px", lh: "110%", text: "AI Readiness Assessment" },
            { label: "H1", font: "Space Grotesk", size: "40px", weight: 500, tracking: "-1.54px", lh: "110%", text: "AI Readiness Assessment" },
            { label: "H2", font: "Space Grotesk", size: "32px", weight: 500, tracking: "-0.86px", lh: "39px", text: "Our Services & Solutions" },
            { label: "H3", font: "Space Grotesk", size: "18px", weight: 500, tracking: "-0.18px", lh: "23px", text: "Responsible AI Framework" },
            { label: "Body Large", font: "Inter", size: "18px", weight: 300, lh: "120%", text: "We help organizations navigate the complexities of AI adoption." },
            { label: "Body", font: "Inter", size: "15px", weight: 400, lh: "130%", text: "We help organizations navigate the complexities of AI adoption." },
            { label: "Eyebrow", font: "Inter", size: "13px", weight: 400, lh: "19.5px", text: "OUR APPROACH" },
            { label: "Label", font: "Inter", size: "11px", weight: 500, tracking: "1.1px", lh: "18px", text: "PHASE 01" },
          ].map((item) => (
            <div key={item.label} style={{ display: "flex", alignItems: "baseline", gap: "24px" }}>
              <div style={{ width: "100px", minWidth: "100px" }}>
                <p style={{ fontSize: "11px", color: "#b2bec3", margin: 0 }}>{item.label}</p>
                <p style={{ fontSize: "11px", color: "#e87964", margin: "2px 0 0" }}>{item.size}/{item.weight}</p>
              </div>
              <p style={{ fontFamily: item.font, fontSize: item.size, fontWeight: item.weight, letterSpacing: item.tracking, lineHeight: item.lh, margin: 0, color: "#2c3436" }}>{item.text}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const meta = {
  title: "Foundations/Typography",
  component: TypographyDisplay,
  parameters: { layout: "fullscreen", backgrounds: { default: "cream" } },
  tags: ["autodocs"],
} satisfies Meta<typeof TypographyDisplay>;

export default meta;
type Story = StoryObj<typeof meta>;
export const AllTypography: Story = {};
