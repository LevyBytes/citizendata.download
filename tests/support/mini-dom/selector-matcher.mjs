// Decides whether an element of the test DOM matches a parsed selector.
import { Element } from "./element-class.mjs";

function matchesCompound(element, compound) {
  if (compound.tag && element.localName !== compound.tag) return false;
  if (compound.id && element.id !== compound.id) return false;
  if (compound.classes.length) {
    const names = element.className.split(/\s+/u);
    if (!compound.classes.every((name) => names.includes(name))) return false;
  }
  for (const { name, operator, value } of compound.attributes) {
    const actual = element.getAttribute(name);
    if (actual === null) return false;
    if (operator === "=" && actual !== value) return false;
    if (operator === "*=" && !(value && actual.includes(value))) return false;
    if (operator === "^=" && !(value && actual.startsWith(value))) return false;
    if (operator === "$=" && !(value && actual.endsWith(value))) return false;
  }
  for (const pseudo of compound.pseudos) {
    const siblings = element.parentNode?.children ?? [element];
    if (pseudo === "first-child" && siblings[0] !== element) return false;
    if (pseudo === "last-child" && siblings.at(-1) !== element) return false;
  }
  return true;
}

// `complex` is one selector as the selector parser returns it; `index` is the part of it `element` has to match.
export function matchesComplex(element, complex, index) {
  if (!(element instanceof Element) || !matchesCompound(element, complex[index].compound)) return false;
  if (index === 0) return true;
  if (complex[index].combinator === "child") return matchesComplex(element.parentNode, complex, index - 1);
  for (let ancestor = element.parentNode; ancestor instanceof Element; ancestor = ancestor.parentNode) {
    if (matchesComplex(ancestor, complex, index - 1)) return true;
  }
  return false;
}
