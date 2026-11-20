// A parsed document of the test DOM: its root element, its body and title, and selector queries over the whole of it.

export class Document {
  constructor(documentElement) {
    this.documentElement = documentElement;
  }

  get body() {
    return this.documentElement.children.find((child) => child.localName === "body") ?? null;
  }

  get title() {
    return (this.querySelector("title")?.textContent ?? "").replace(/\s+/gu, " ").trim();
  }

  querySelectorAll(selector) {
    const all = this.documentElement.querySelectorAll(selector);
    return this.documentElement.matches(selector) ? [this.documentElement, ...all] : all;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}
