import type { ContentSource } from "../types";
/** The built-in library: variants are authored in Nexus, so there is nothing to sync. */
export const nexusLibrarySource: ContentSource = {
  id: "nexus-library",
  activation: "inline",
  async listItems() { return { items: [], skipped: [] }; },
  async testConnection() { return { ok: true, sample: [] }; },
};
