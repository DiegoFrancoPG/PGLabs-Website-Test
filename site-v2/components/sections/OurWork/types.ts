export type ProjectId =
  | "welcome-coach"
  | "vesta"
  | "credit-canada"
  | "ai-program";

export type BadgeTint = "green" | "rose" | "gold" | "azure";

/** v2 accent names — see design-system-v2/tailwind.config.ts */
export type AccentColor = "brand" | "gold" | "coral" | "azure";

export interface StatCard {
  value: string;
  label: string;
}

export interface FeatureItem {
  icon: string;
  label: string;
  sublabel: string;
}

type WelcomeCoachPanel = {
  kind: "welcome-coach";
  stats: [StatCard, StatCard];
  features: string[];
  supporters: string[];
};

type FeatureListPanel = {
  kind: "vesta" | "credit-canada" | "ai-program";
  featureTitle: string;
  features: FeatureItem[];
};

export type RightPanel = WelcomeCoachPanel | FeatureListPanel;

export interface Project {
  id: ProjectId;
  name: string;
  icon: string;
  iconColor: AccentColor;
  badge: string;
  badgeTint: BadgeTint;
  category: string;
  headline: string;
  description: string;
  tags: string[];
  cta: { label: string; href: string };
  imagePlaceholder: string;
  panel: RightPanel;
}
