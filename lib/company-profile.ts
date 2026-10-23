// Only copy fields actually supplied by the provider. Missing facts stay null.
export function normalizeCompanyProfile(summary: any) {
  const asset = summary?.assetProfile ?? {};
  const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
  const website = text(asset.website);
  return {
    description: text(asset.longBusinessSummary),
    sector: text(asset.sector),
    industry: text(asset.industry),
    website: website && /^https?:\/\//i.test(website) ? website : null,
    headquarters: [text(asset.city), text(asset.state), text(asset.country)].filter(Boolean).join(', ') || null,
    employees: Number.isInteger(asset.fullTimeEmployees) && asset.fullTimeEmployees >= 0 ? asset.fullTimeEmployees : null,
    officers: Array.isArray(asset.companyOfficers) ? asset.companyOfficers.flatMap((officer: any) => {
      const name = text(officer?.name), title = text(officer?.title);
      return name && title ? [{ name, title }] : [];
    }) : [],
  };
}
