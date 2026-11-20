// The two plainest kinds of node in the test DOM: what every node can do, and a run of text.

export class Node {
  constructor() {
    this.parentNode = null;
  }

  get nextSibling() {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }

  get previousSibling() {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) - 1] ?? null;
  }

  remove() {
    const siblings = this.parentNode?.childNodes;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parentNode = null;
  }
}

export class Text extends Node {
  constructor(text) {
    super();
    this.textContent = text;
  }

  cloneNode() {
    return new Text(this.textContent);
  }
}
