import type { ContentSourceConfig, ContentSourceId } from "./config";
import { contentfulSource } from "./adapters/contentful";
import { sanitySource } from "./adapters/sanity";
import { genericJsonSource } from "./adapters/generic-json";
import { nexusLibrarySource } from "./adapters/nexus-library";
import { ContentSourceNotConfigured, type ContentSource } from "./types";

export function createContentSource(
  id: ContentSourceId, config: ContentSourceConfig,
  env: NodeJS.ProcessEnv = process.env, fetchImpl?: typeof fetch,
): ContentSource {
  switch (id) {
    case "nexus-library": return nexusLibrarySource;
    case "contentful": return contentfulSource(config, env, fetchImpl);
    case "sanity": return sanitySource(config, env, fetchImpl);
    case "generic-json": return genericJsonSource(config, env, fetchImpl);
    default: throw new ContentSourceNotConfigured(`${id} adapter is not available`);
  }
}
