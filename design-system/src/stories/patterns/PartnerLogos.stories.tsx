import type { Meta, StoryObj } from "@storybook/react";
import { PartnerLogos } from "@/components/custom/partner-logos";

const meta = {
  title: "Patterns/PartnerLogos",
  component: PartnerLogos,
  parameters: { layout: "padded", backgrounds: { default: "cream" } },
  tags: ["autodocs"],
} satisfies Meta<typeof PartnerLogos>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const OnDark: Story = {
  parameters: { backgrounds: { default: "dark-grey" } },
  args: {
    partners: [
      { name: "UNICEF" },
      { name: "GIZ" },
      { name: "USAID" },
      { name: "Fundación Corona" },
      { name: "Rockefeller" },
      { name: "IDRC" },
    ],
  },
};
