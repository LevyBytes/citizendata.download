// Parses a selector of the forms the test DOM handles into the parts the selector matcher reads.

const selectorCache = new Map();
const ATTRIBUTE = /^\[\s*([\w-]+)\s*(?:([*^$]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/u;

function parseCompound(source) {
  const compound = { tag: null, id: null, classes: [], attributes: [], pseudos: [] };
  let rest = source;
  const take = (pattern) => {
    const match = pattern.exec(rest);
    if (match) rest = rest.slice(match[0].length);
    return match;
  };
  const tag = take(/^(?:[a-z][a-z0-9-]*|\*)/iu);
  if (tag && tag[0] !== "*") compound.tag = tag[0].toLowerCase();
  while (rest) {
    const id = take(/^#([\w-]+)/u);
    const className = id ? null : take(/^\.([\w-]+)/u);
    const attribute = id || className ? null : take(ATTRIBUTE);
    const pseudo = id || className || attribute ? null : take(/^:(first-child|last-child)/u);
    if (id) compound.id = id[1];
    else if (className) compound.classes.push(className[1]);
    else if (attribute) compound.attributes.push({ name: attribute[1].toLowerCase(), operator: attribute[2] ?? null, value: attribute[3] ?? attribute[4] ?? attribute[5] ?? null });
    else if (pseudo) compound.pseudos.push(pseudo[1]);
    else throw new SyntaxError(`Unsupported selector in the test DOM: ${source}`);
  }
  return compound;
}

function parseComplex(source) {
  // Split on combinators, keeping bracketed attribute values whole.
  const parts = [];
  let current = "";
  let combinator = null;
  let depth = 0;
  let quote = null;
  const push = () => {
    if (!current) return;
    parts.push({ combinator: parts.length ? combinator ?? "descendant" : null, compound: parseCompound(current) });
    current = "";
    combinator = null;
  };
  for (const character of source.trim()) {
    if (quote) {
      current += character;
      if (character === quote) quote = null;
    } else if (depth > 0 && (character === '"' || character === "'")) {
      quote = character;
      current += character;
    } else if (character === "[") {
      depth += 1;
      current += character;
    } else if (character === "]") {
      depth -= 1;
      current += character;
    } else if (depth === 0 && character === ">") {
      push();
      combinator = "child";
    } else if (depth === 0 && /\s/u.test(character)) {
      push();
    } else {
      current += character;
    }
  }
  push();
  if (!parts.length) throw new SyntaxError(`Empty selector in the test DOM: ${source}`);
  return parts;
}

// A comma list of selectors as a list of selectors, each a list of its parts. A selector is parsed once and kept.
export function parseSelectorList(selector) {
  let parsed = selectorCache.get(selector);
  if (!parsed) {
    const sources = [];
    let current = "";
    let depth = 0;
    for (const character of selector) {
      if (character === "[") depth += 1;
      if (character === "]") depth -= 1;
      if (character === "," && depth === 0) {
        sources.push(current);
        current = "";
      } else {
        current += character;
      }
    }
    sources.push(current);
    parsed = sources.map(parseComplex);
    selectorCache.set(selector, parsed);
  }
  return parsed;
}
