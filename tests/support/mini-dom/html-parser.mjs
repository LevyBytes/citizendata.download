// Reads well-formed HTML text into the nodes of the test DOM.
import { Element } from "./element-class.mjs";
import { decodeEntities } from "./html-entity-decoder.mjs";
import { Text } from "./node-and-text-classes.mjs";

const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const RAW_TEXT_ELEMENTS = new Set(["script", "style"]);

function parseAttributes(source) {
  const attributes = new Map();
  for (const match of source.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu)) {
    const name = match[1].toLowerCase();
    if (!attributes.has(name)) attributes.set(name, decodeEntities(match[2] ?? match[3] ?? match[4] ?? ""));
  }
  return attributes;
}

// The top-level nodes of the markup, in order.
export function parseNodes(html) {
  const root = new Element("#fragment");
  const open = [root];
  const token = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-z][a-z0-9-]*)\s*>|<([a-z][a-z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/giu;
  let position = 0;
  const text = (end) => {
    if (end > position) open.at(-1).append(new Text(decodeEntities(html.slice(position, end))));
  };
  for (let match = token.exec(html); match; match = token.exec(html)) {
    text(match.index);
    position = token.lastIndex;
    if (match[1]) {
      const name = match[1].toLowerCase();
      const depth = open.findLastIndex((element) => element.localName === name);
      if (depth > 0) open.length = depth;
    } else if (match[2]) {
      const name = match[2].toLowerCase();
      const selfClosing = match[3].trimEnd().endsWith("/");
      const element = new Element(name, parseAttributes(selfClosing ? match[3].trimEnd().slice(0, -1) : match[3]));
      open.at(-1).append(element);
      if (RAW_TEXT_ELEMENTS.has(name)) {
        const close = html.toLowerCase().indexOf(`</${name}`, position);
        const end = close < 0 ? html.length : close;
        element.append(new Text(html.slice(position, end)));
        position = end;
        token.lastIndex = end;
      } else if (!VOID_ELEMENTS.has(name) && !selfClosing) {
        open.push(element);
      }
    }
  }
  text(html.length);
  return root.childNodes;
}
