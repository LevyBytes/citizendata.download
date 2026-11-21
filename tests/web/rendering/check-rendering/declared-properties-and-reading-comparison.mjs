// The parts of the rendering check that need no browser.

// Read on every page, whatever its stylesheets declare: what places and sizes an element, and what it looks like.
export const ALWAYS_READ = [
  "display", "position", "top", "right", "bottom", "left", "z-index", "float", "visibility", "opacity", "transform", "overflow-x", "overflow-y",
  "width", "height", "min-width", "min-height", "max-width", "max-height", "box-sizing",
  "margin-top", "margin-right", "margin-bottom", "margin-left", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border-top-width", "border-right-width", "border-bottom-width", "border-left-width", "border-top-style", "border-top-color",
  "color", "background-color", "background-image", "font-family", "font-size", "font-weight", "line-height", "text-align", "white-space"
];

// The property names a stylesheet declares, comments left out. Names are lowercased, except a custom property's,
// which keeps its case. A selector inside a block can read as a name (the `a` of `@media print { a:hover {`); such a
// name reads empty on every element of both pages, so it costs time and nothing else.
export function declaredProperties(css) {
  const names = new Set();
  for (const match of css.replace(/\/\*[\s\S]*?\*\//gu, "").matchAll(/[{;]\s*(-{0,2}[A-Za-z_][A-Za-z0-9_-]*)\s*:/gu)) {
    names.add(match[1].startsWith("--") ? match[1] : match[1].toLowerCase());
  }
  return names;
}

// The properties to read: those always read and those either version of the stylesheets declares, sorted.
export function propertiesToRead(stylesheets) {
  return [...new Set([...ALWAYS_READ, ...stylesheets.flatMap((css) => [...declaredProperties(css)])])].sort();
}

// A grid's tracks read as declared, not as sized, on a fieldset, whose grid is laid out in an inner box.
export const isGridTrack = (name) => /^grid-template|^grid$/u.test(name);

// Which elements two readings of a page tell apart. Readings of different elements, in number or in name, are not
// compared element by element: the page's structure changed, and `structure` says how. An element whose tag changed
// is compared by its reading without grid tracks; its children's boxes show whether its grid moved.
export function differingElements(before, now) {
  if (before.names.length !== now.names.length) return { structure: `${before.names.length} elements before, ${now.names.length} now`, differing: [], retagged: 0 };
  const renamed = before.names.findIndex((name, at) => name !== now.names[at]);
  if (renamed >= 0) return { structure: `element ${renamed + 1} is ${before.names[renamed]} before and ${now.names[renamed]} now`, differing: [], retagged: 0 };
  const differing = [];
  let retagged = 0;
  for (let at = 0; at < before.names.length; at += 1) {
    const newTag = before.tags[at] !== now.tags[at];
    if (newTag) retagged += 1;
    if (newTag ? before.loose[at] !== now.loose[at] : before.full[at] !== now.full[at]) differing.push(at);
  }
  return { structure: null, differing, retagged };
}

// What changed in one element's full reading, as "name: before -> now", grid tracks left out for an element whose tag
// changed. Names carry their pseudo-element in front ("::beforecontent").
export function changedValues(before, now, newTag) {
  return Object.keys(before)
    .filter((name) => before[name] !== now[name] && !(newTag && isGridTrack(name.replace(/^::(?:before|after)/u, ""))))
    .map((name) => `${name}: ${before[name]} -> ${now[name]}`);
}
