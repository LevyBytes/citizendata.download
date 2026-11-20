// A small HTML parser and selector engine for tests.
//
// It exists so the extension's page extractors, which normally run against a browser DOMParser document, can run under
// Node against the synthetic RSI markup. It handles well-formed markup and the selector forms the extractors use:
// tag, #id, .class, [attribute] with =, *=, ^=, $=, :first-child, :last-child, descendant and child combinators, and
// comma lists. It is not a general DOM. The end-to-end check runs the same extractors in Chrome on the same markup.
//
// Its parts are the files of mini-dom/: the node, element and document classes, the HTML parser with its entity
// decoder, the selector parser and matcher, and the document builder.
import { buildDocument } from "./mini-dom/document-builder.mjs";
import { parseNodes } from "./mini-dom/html-parser.mjs";

export class DOMParser {
  parseFromString(html, type) {
    if (type !== "text/html") throw new TypeError("The test DOM parses text/html only.");
    return buildDocument([...parseNodes(String(html))]);
  }
}
