export type ActivationVariant = {
  contentSource: string;
  externalRef: string | null;
  title: string | null;
  body: string;
  cta: string | null;
  link: string | null;
};

/** The reference part of a trigger/canvas property bag. Empty when there is no catalog item. */
export function referenceProperties(catalogItemId: string | null): Record<string, string> {
  return catalogItemId ? { catalog_item_id: catalogItemId } : {};
}

/** Property bag Nexus sends to a Braze API-triggered campaign or canvas. Reference mode adds the catalog id NEXT TO the copy. */
export function buildActivationProperties(v: ActivationVariant, mode: "inline" | "reference"): Record<string, string> {
  const copy: Record<string, string> = {};
  if (v.title) copy.title = v.title;
  copy.message = v.body;
  if (v.cta) copy.cta = v.cta;
  if (v.link) copy.link = v.link;
  return mode === "reference" ? { ...copy, ...referenceProperties(v.externalRef) } : copy;
}

/** The Liquid a Braze template uses to render the catalog item Nexus picked. */
export function brazeCatalogLiquid(catalogName: string, property: string = "api_trigger_properties"): string {
  return `{% catalog_items ${catalogName} {{${property}.\${catalog_item_id}}} %}`;
}

type CatalogRef = { contentSource: string; externalRef: string | null };

/**
 * The catalog item a variant activates: its own ref when it is a Braze Catalog variant,
 * otherwise its source template's ref when that template is one (agent clones of synced items).
 */
export function catalogItemIdFor(variant: CatalogRef, template: CatalogRef | null | undefined): string | null {
  if (variant.contentSource === "braze-catalog") return variant.externalRef;
  if (template?.contentSource === "braze-catalog") return template.externalRef;
  return null;
}
