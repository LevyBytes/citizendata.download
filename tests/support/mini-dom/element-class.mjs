// An element of the test DOM: its attributes, its children, and the selector queries the extractors make on it.
import { Node } from "./node-and-text-classes.mjs";
import { matchesComplex } from "./selector-matcher.mjs";
import { parseSelectorList } from "./selector-parser.mjs";

const VALUE_ELEMENTS = new Set(["input", "option", "button", "textarea", "select"]);

export class Element extends Node {
  constructor(localName, attributes = new Map()) {
    super();
    this.localName = localName;
    this.tagName = localName.toUpperCase();
    this.attributes = attributes;
    this.childNodes = [];
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }

  get children() {
    return this.childNodes.filter((node) => node instanceof Element);
  }

  get textContent() {
    return this.childNodes.map((node) => node.textContent).join("");
  }

  get innerText() {
    return this.textContent;
  }

  get id() {
    return this.getAttribute("id") ?? "";
  }

  get className() {
    return this.getAttribute("class") ?? "";
  }

  get classList() {
    const names = this.className.split(/\s+/u).filter(Boolean);
    return { contains: (name) => names.includes(name), length: names.length };
  }

  // Form controls expose their value attribute as a property; other elements have no such property.
  get value() {
    return VALUE_ELEMENTS.has(this.localName) ? this.getAttribute("value") ?? "" : undefined;
  }

  get alt() {
    return this.localName === "img" ? this.getAttribute("alt") ?? "" : undefined;
  }

  getAttribute(name) {
    return this.attributes.get(String(name).toLowerCase()) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(String(name).toLowerCase());
  }

  cloneNode(deep = false) {
    const copy = new Element(this.localName, new Map(this.attributes));
    if (deep) copy.append(...this.childNodes.map((node) => node.cloneNode(true)));
    return copy;
  }

  matches(selector) {
    return parseSelectorList(selector).some((complex) => matchesComplex(this, complex, complex.length - 1));
  }

  querySelectorAll(selector) {
    const list = parseSelectorList(selector);
    const found = [];
    const visit = (element) => {
      for (const child of element.children) {
        if (list.some((complex) => matchesComplex(child, complex, complex.length - 1))) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}
