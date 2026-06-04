// Braze push copy is stored as Liquid with a blank-check fallback, e.g.:
//   {% if ${first_name} == blank %}Will you join us?{% else %}{{${first_name} | default: '' }}, will you join us?{% endif %}
// For read-only display we always surface the *personalized* branch with the
// recipient's name shown as a literal {NAME} token, so reviewers see the
// intended message instead of raw Liquid. The DB keeps the full Liquid, and the
// edit form / live wizard preview still operate on the raw source.
const NAME_TOKEN = "{NAME}";

// `{% if ${x} == blank %}FALLBACK{% else %}PERSONALIZED{% endif %}` → PERSONALIZED
const IF_BLANK_ELSE =
  /\{%-?\s*if\b[^%]*?==\s*blank\s*-?%\}[\s\S]*?\{%-?\s*else\s*-?%\}([\s\S]*?)\{%-?\s*endif\s*-?%\}/gi;
// `{% if ${x} != blank %}PERSONALIZED{% else %}FALLBACK{% endif %}` → PERSONALIZED
const IF_PRESENT_ELSE =
  /\{%-?\s*if\b[^%]*?!=\s*blank\s*-?%\}([\s\S]*?)\{%-?\s*else\s*-?%\}[\s\S]*?\{%-?\s*endif\s*-?%\}/gi;
// Any remaining Liquid statement tag (unmatched if/endif, loops, etc.).
const LIQUID_TAG = /\{%-?[\s\S]*?-?%\}/g;
// A first_name output tag, with or without a `| default:` filter.
const FIRST_NAME_OUTPUT = /\{\{\s*\$?\{?\s*first_name\s*\}?[^}]*\}\}/gi;
// A bare ${first_name} appearing as visible text.
const FIRST_NAME_BARE = /\$\{\s*first_name\s*\}/gi;

export function maskPersonalization(text: string | null | undefined): string | null {
  if (!text) return null;

  let out = text
    .replace(IF_BLANK_ELSE, "$1")
    .replace(IF_PRESENT_ELSE, "$1")
    .replace(LIQUID_TAG, "")
    .replace(FIRST_NAME_OUTPUT, NAME_TOKEN)
    .replace(FIRST_NAME_BARE, NAME_TOKEN);

  out = out.replace(/[ \t]{2,}/g, " ").trim();
  return out;
}
