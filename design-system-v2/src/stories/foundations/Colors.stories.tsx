import type { Meta, StoryObj } from "@storybook/react";

const colorGroups = [
  {
    name: "Ink — headings & dark sections",
    tokens: [
      { name: "ink-900", value: "#10161f", label: "Ink 900" },
      { name: "ink-800", value: "#1a2230", label: "Ink 800", note: "Deck ink" },
      { name: "ink-700", value: "#2a3f5c", label: "Ink 700" },
      { name: "ink-600", value: "#474f5e", label: "Ink 600" },
    ],
  },
  {
    name: "Steel — body copy & hairlines",
    tokens: [
      { name: "steel-500", value: "#667083", label: "Steel 500", note: "Deck body copy" },
      { name: "steel-400", value: "#8595ab", label: "Steel 400" },
      { name: "steel-300", value: "#9daac0", label: "Steel 300" },
      { name: "steel-200", value: "#c9d4e2", label: "Steel 200", note: "Hairlines" },
      { name: "steel-100", value: "#e4eaf2", label: "Steel 100" },
    ],
  },
  {
    name: "Brand blue",
    tokens: [
      { name: "brand-700", value: "#0e5f81", label: "Brand 700" },
      { name: "brand-600", value: "#11739c", label: "Brand 600", note: "Primary" },
      { name: "brand-500", value: "#59c4ed", label: "Brand 500", note: "Deck accent" },
      { name: "brand-400", value: "#7ecff1", label: "Brand 400" },
      { name: "brand-100", value: "#ddeffb", label: "Brand 100", border: true },
    ],
  },
  {
    name: "Data accents",
    tokens: [
      { name: "gold-500", value: "#e8a33d", label: "Gold" },
      { name: "coral-500", value: "#e2624a", label: "Coral" },
      { name: "azure-500", value: "#59c4ed", label: "Azure" },
    ],
  },
  {
    name: "Surfaces",
    tokens: [
      { name: "surface-raised", value: "#ffffff", label: "Raised", border: true },
      { name: "surface", value: "#f4f6f8", label: "Surface", border: true, note: "Deck light fill" },
      { name: "surface-sunken", value: "#e9edf2", label: "Sunken", border: true },
    ],
  },
];

function ColorsDisplay() {
  return (
    <div
      style={{
        fontFamily: "'Open Sans', sans-serif",
        padding: "40px",
        backgroundColor: "#ffffff",
        minHeight: "100vh",
      }}
    >
      <h1
        style={{
          fontFamily: "'Playfair Display', Georgia, serif",
          fontSize: "40px",
          fontWeight: 600,
          letterSpacing: "-0.02em",
          marginBottom: "8px",
          color: "#1a2230",
        }}
      >
        Colour tokens
      </h1>
      <p style={{ color: "#667083", marginBottom: "56px", maxWidth: "68ch" }}>
        Sampled directly from the PeaceGeeks NY Donor Deck. Ink navy carries the
        headings, steel carries the body, blue is the brand, and gold/coral/azure
        are reserved for data emphasis.
      </p>

      {colorGroups.map((group) => (
        <div key={group.name} style={{ marginBottom: "44px" }}>
          <h2
            style={{
              fontFamily: "'Open Sans', sans-serif",
              fontWeight: 600,
              color: "#8595ab",
              marginBottom: "20px",
              textTransform: "uppercase" as const,
              letterSpacing: "0.14em",
              fontSize: "12px",
            }}
          >
            {group.name}
          </h2>
          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" as const }}>
            {group.tokens.map((token) => (
              <div key={token.name} style={{ width: "168px" }}>
                <div
                  style={{
                    width: "100%",
                    height: "84px",
                    borderRadius: "3px",
                    backgroundColor: token.value,
                    border: token.border ? "1px solid #c9d4e2" : "none",
                    marginBottom: "10px",
                  }}
                />
                <p style={{ fontSize: "14px", fontWeight: 600, color: "#1a2230", margin: 0 }}>
                  {token.label}
                </p>
                <p style={{ fontSize: "12px", color: "#667083", margin: "2px 0 0" }}>
                  {token.value}
                </p>
                <p
                  style={{
                    fontSize: "11px",
                    color: "#9daac0",
                    margin: "2px 0 0",
                    fontFamily: "monospace",
                  }}
                >
                  {token.name}
                </p>
                {token.note && (
                  <p style={{ fontSize: "11px", color: "#11739c", margin: "4px 0 0" }}>
                    {token.note}
                  </p>
                )}
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
    backgrounds: { default: "white" },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ColorsDisplay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllColors: Story = {};
