import type { Meta, StoryObj } from "@storybook/react";

const DISPLAY = "'Playfair Display', Georgia, serif";
const BODY = "'Open Sans', sans-serif";

const scale = [
  { label: "Display", font: DISPLAY, size: "64px", weight: 600, tracking: "-0.025em", lh: "1.05", text: "Talent is universally distributed" },
  { label: "H1", font: DISPLAY, size: "52px", weight: 600, tracking: "-0.022em", lh: "1.08", text: "Migration isn't charity. It's math." },
  { label: "H2", font: DISPLAY, size: "40px", weight: 600, tracking: "-0.02em", lh: "1.14", text: "Newcomers build more than they take" },
  { label: "H3", font: DISPLAY, size: "28px", weight: 600, tracking: "-0.015em", lh: "1.22", text: "The bottleneck isn't talent" },
  { label: "H4", font: DISPLAY, size: "20px", weight: 600, tracking: "-0.01em", lh: "1.32", text: "Skill mapping & job match" },
  { label: "Stat LG", font: DISPLAY, size: "88px", weight: 600, tracking: "-0.035em", lh: "0.95", text: "380K+" },
  { label: "Stat", font: DISPLAY, size: "64px", weight: 600, tracking: "-0.03em", lh: "1", text: "167K+" },
  { label: "Lede", font: BODY, size: "22px", weight: 300, lh: "1.5", text: "The technology to guide, match, and credential people at scale already exists." },
  { label: "Body LG", font: BODY, size: "19px", weight: 400, lh: "1.62", text: "The technology to guide, match, and credential people at scale already exists." },
  { label: "Body", font: BODY, size: "17px", weight: 400, lh: "1.6", text: "It has simply never been built for the people who need it most." },
  { label: "Body SM", font: BODY, size: "15px", weight: 400, lh: "1.55", text: "It has simply never been built for the people who need it most." },
  { label: "Eyebrow", font: BODY, size: "12px", weight: 600, tracking: "0.14em", lh: "1", text: "THE GLOBAL PICTURE" },
  { label: "Label", font: BODY, size: "11px", weight: 600, tracking: "0.1em", lh: "1.4", text: "IN DEVELOPMENT" },
  { label: "Source", font: BODY, size: "12px", weight: 400, lh: "1.45", text: "— UNHCR, 2025" },
];

function TypographyDisplay() {
  return (
    <div
      style={{
        fontFamily: BODY,
        padding: "40px",
        backgroundColor: "#ffffff",
        minHeight: "100vh",
        color: "#1a2230",
      }}
    >
      <h1
        style={{
          fontFamily: DISPLAY,
          fontSize: "40px",
          fontWeight: 600,
          letterSpacing: "-0.02em",
          marginBottom: "8px",
        }}
      >
        Typography
      </h1>
      <p style={{ color: "#667083", marginBottom: "56px", maxWidth: "68ch" }}>
        The deck pairs Playfair Display SemiBold for display with Open Sans for
        body — an editorial voice with the authority a donor conversation needs.
      </p>

      <section style={{ marginBottom: "56px" }}>
        <h2
          style={{
            fontSize: "12px",
            fontWeight: 600,
            letterSpacing: "0.14em",
            textTransform: "uppercase" as const,
            color: "#8595ab",
            marginBottom: "24px",
          }}
        >
          Font families
        </h2>
        <div style={{ display: "flex", gap: "56px", flexWrap: "wrap" as const }}>
          <div>
            <p style={{ fontSize: "11px", color: "#9daac0", marginBottom: "10px", letterSpacing: "0.1em" }}>
              DISPLAY — PLAYFAIR DISPLAY
            </p>
            <p style={{ fontFamily: DISPLAY, fontSize: "40px", fontWeight: 600, margin: 0 }}>
              Aa Bb Cc 123
            </p>
            <p style={{ fontFamily: DISPLAY, fontSize: "17px", color: "#667083", marginTop: "8px" }}>
              Medium · SemiBold · Bold · ExtraBold · Black
            </p>
          </div>
          <div>
            <p style={{ fontSize: "11px", color: "#9daac0", marginBottom: "10px", letterSpacing: "0.1em" }}>
              BODY — OPEN SANS
            </p>
            <p style={{ fontFamily: BODY, fontSize: "40px", fontWeight: 400, margin: 0 }}>
              Aa Bb Cc 123
            </p>
            <p style={{ fontFamily: BODY, fontSize: "17px", color: "#667083", marginTop: "8px" }}>
              Light · Regular · Medium · SemiBold · Bold
            </p>
          </div>
        </div>
      </section>

      <section>
        <h2
          style={{
            fontSize: "12px",
            fontWeight: 600,
            letterSpacing: "0.14em",
            textTransform: "uppercase" as const,
            color: "#8595ab",
            marginBottom: "24px",
          }}
        >
          Type scale
        </h2>
        <div
          style={{
            display: "flex",
            flexDirection: "column" as const,
            gap: "28px",
            borderLeft: "1px solid #c9d4e2",
            paddingLeft: "28px",
          }}
        >
          {scale.map((item) => (
            <div key={item.label} style={{ display: "flex", alignItems: "baseline", gap: "28px" }}>
              <div style={{ width: "104px", minWidth: "104px" }}>
                <p style={{ fontSize: "11px", color: "#9daac0", margin: 0, letterSpacing: "0.08em" }}>
                  {item.label.toUpperCase()}
                </p>
                <p style={{ fontSize: "11px", color: "#11739c", margin: "3px 0 0", fontFamily: "monospace" }}>
                  {item.size}/{item.weight}
                </p>
              </div>
              <p
                style={{
                  fontFamily: item.font,
                  fontSize: item.size,
                  fontWeight: item.weight,
                  letterSpacing: item.tracking,
                  lineHeight: item.lh,
                  margin: 0,
                  color: "#1a2230",
                  fontVariantNumeric: "tabular-nums lining-nums",
                }}
              >
                {item.text}
              </p>
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
  parameters: { layout: "fullscreen", backgrounds: { default: "white" } },
  tags: ["autodocs"],
} satisfies Meta<typeof TypographyDisplay>;

export default meta;
type Story = StoryObj<typeof meta>;
export const AllTypography: Story = {};
