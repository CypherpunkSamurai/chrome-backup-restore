// Build the popup sprite from the icon list below. Run: node tools/build-sprite.mjs

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HOST = "https://api.iconify.design";

// Filled weight for nav glyphs, line weight for action buttons. Regular
// Phosphor icons draw an outline as a filled outline, so the weight is the
// only way to ask for a solid shape.
const ICONS = {
  // The app mark, matching icons/icon*.png: an isometric box with a raised
  // lid. No arrow and no file metaphor, so it is not the generic transfer
  // pictogram every backup tool in a toolbar reaches for.
  sync: "ix:box-open",
  // This panel exports and restores which extensions are on or off, so a
  // filled toggle states the job better than a puzzle piece, and it stays
  // distinct from the checkbox rows right below it.
  puzzle: "ph:toggle-left-fill",
  bookmark: "ph:bookmark-fill",
  history: "ph:clock-fill",
  cookie: "ph:cookie-fill",
  storage: "ph:hard-drives-fill",
  export: "ph:export",
  import: "ph:tray-arrow-down",
  // Status glyphs, from Tabler instead of Phosphor. Tabler ships solid
  // variants of the same four states, so one shape per state, no outline.
  // Phosphor kept these as line marks, and a thin ring inside a 2px status
  // border read as noise at 13.5px.
  check: "tabler:circle-check-filled",
  info: "tabler:info-circle-filled",
  alert: "tabler:alert-triangle-filled",
  // A filled question mark states the help panel better than a book, and the
  // caret is the disclosure mark for the answers it opens.
  faq: "ph:question-fill",
  caret: "ph:caret-down-fill",
  close: "ph:x",
  error: "tabler:circle-x-filled",
};

const bySet = new Map();
for (const [id, spec] of Object.entries(ICONS)) {
  const [set, name] = spec.split(":");
  bySet.set(set, [...(bySet.get(set) || []), name].sort());
}

const symbols = [];
for (const [set, names] of bySet) {
  const url = `${HOST}/${set}.json?icons=${names.join(",")}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${set}: HTTP ${res.status}`);
  const data = await res.json();
  if (data.not_found?.length) throw new Error(`${set}: not found ${data.not_found.join(", ")}`);

  // An alias response lists the parent under icons, so map the parent back to
  // every requested name that resolves to it.
  const idForName = new Map();
  for (const [id, spec] of Object.entries(ICONS)) {
    const [s, name] = spec.split(":");
    if (s === set) idForName.set(name, id);
  }
  for (const [name, alias] of Object.entries(data.aliases)) {
    if (idForName.has(name)) idForName.set(alias.parent, idForName.get(name));
  }

  const viewBox = `0 0 ${data.width} ${data.height}`;
  for (const [name, icon] of Object.entries(data.icons)) {
    const id = idForName.get(name);
    if (!id) continue;
    symbols.push(`    <symbol id="i-${id}" viewBox="${viewBox}">\n      ${icon.body}\n    </symbol>`);
  }
}

const missing = Object.keys(ICONS).filter(
  id => !symbols.some(s => s.includes(`id="i-${id}"`))
);
if (missing.length) throw new Error(`unresolved icons: ${missing.join(", ")}`);

symbols.sort();
const sprite =
  `<svg class="sprite" aria-hidden="true" focusable="false">\n  <defs>\n` +
  `${symbols.join("\n")}\n  </defs>\n</svg>`;

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "popup.html");
const html = await readFile(out, "utf8");
const re = /<svg class="sprite"[\s\S]*?<\/svg>/;
if (!re.test(html)) throw new Error("no sprite block in popup.html");
await writeFile(out, html.replace(re, sprite), "utf8");
console.log(`wrote ${symbols.length} symbols to popup.html`);
