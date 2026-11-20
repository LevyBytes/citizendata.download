// Makes a document of the test DOM out of parsed nodes.
import { Document } from "./document-class.mjs";
import { Element } from "./element-class.mjs";

// Builds the html, head, body shape a browser gives every parsed document, including a bare fragment.
export function buildDocument(nodes) {
  const htmlElement = nodes.find((node) => node instanceof Element && node.localName === "html");
  if (htmlElement) {
    htmlElement.parentNode = null;
    if (!htmlElement.children.some((child) => child.localName === "body")) htmlElement.append(new Element("body"));
    return new Document(htmlElement);
  }
  const documentElement = new Element("html");
  const head = new Element("head");
  const body = new Element("body");
  documentElement.append(head, body);
  for (const node of nodes) (node instanceof Element && ["title", "meta", "link"].includes(node.localName) ? head : body).append(node);
  return new Document(documentElement);
}
