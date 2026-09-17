export const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "PG Labs",
  description:
    "The innovation and services arm of PeaceGeeks. AI-powered tools and technology strategy for nonprofits, funders, and social impact organizations.",
  url: "https://pg-labs.org",
  parentOrganization: {
    "@type": "Organization",
    name: "PeaceGeeks",
    url: "https://peacegeeks.org",
  },
  knowsAbout: [
    "Responsible AI",
    "Technology strategy for nonprofits",
    "Human-centered design",
    "AI governance",
    "White label software products",
  ],
};
