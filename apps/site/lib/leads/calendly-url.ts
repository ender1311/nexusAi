/** Calendly inline-embed URL with the visitor's details pre-filled (a1 = first custom question). */
export function calendlyEmbedUrl(base: string, lead: { email: string; company: string }): string {
  const u = new URL(base);
  u.searchParams.set("embed_type", "Inline");
  u.searchParams.set("hide_gdpr_banner", "1");
  u.searchParams.set("email", lead.email);
  u.searchParams.set("a1", lead.company);
  return u.toString();
}
