// Runs in the page, handed to it as source: reads every element, or the one at `detailIndex` in full.
//
// It waits for fonts and images, then ends every finite animation and transition and holds every endless one at its
// start. Elements are named by id and classes, not by tag, so an element given a new tag is still itself. Each
// element's reading is its box and, for it and its ::before and ::after, the computed value of each property; a
// property set in the element's own style attribute reads "(inline)", since the page's script writes those as it runs.
// An element under a transform is given its layout box, since its box on screen moves with a transform the page may
// still be easing. The properties at `trackIndexes` are left out of the second reading, for an element whose tag
// changed. Addresses within the page's folder read as "./", so two copies of a page in two folders read the same.
export async function readElements(properties, trackIndexes, detailIndex) {
  await document.fonts.ready;
  const loading = [...document.images].filter((image) => !image.complete && image.loading !== "lazy");
  await Promise.all(loading.map((image) => new Promise((resolve) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", resolve, { once: true });
    setTimeout(resolve, 5000);
  })));
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  for (const animation of document.getAnimations()) {
    try { animation.finish(); } catch { animation.pause(); animation.currentTime = 0; }
  }
  const base = document.URL.replace(/[^/]*$/u, "");
  const elements = [...document.querySelectorAll("*")];
  const transformed = new Set();
  for (const element of elements) if (transformed.has(element.parentElement) || getComputedStyle(element).transform !== "none") transformed.add(element);
  const box = (element) => {
    if (!transformed.has(element)) { const rect = element.getBoundingClientRect(); return [rect.x, rect.y, rect.width, rect.height].map((value) => value.toFixed(2)).join(","); }
    return "offsetLeft" in element ? `layout ${element.offsetLeft},${element.offsetTop},${element.offsetWidth},${element.offsetHeight}` : "transformed";
  };
  const PSEUDOS = [null, "::before", "::after"];
  const read = (element) => PSEUDOS.map((pseudo) => {
    const style = getComputedStyle(element, pseudo);
    return properties.map((name) => (!pseudo && element.style.getPropertyValue(name) ? "(inline)" : style.getPropertyValue(name).split(base).join("./")));
  });
  if (detailIndex !== null) {
    const element = elements[detailIndex];
    const values = { box: box(element) };
    const readings = read(element);
    for (const [place, pseudo] of PSEUDOS.entries()) for (const [at, name] of properties.entries()) values[`${pseudo ?? ""}${name}`] = readings[place][at];
    return values;
  }
  const hash = (text) => {
    let first = 0x811c9dc5;
    let second = 0x01000193;
    for (let at = 0; at < text.length; at += 1) {
      const code = text.charCodeAt(at);
      first = Math.imul(first ^ code, 16777619);
      second = Math.imul(second + code, 2246822519) ^ (second >>> 13);
    }
    return (first >>> 0).toString(36) + (second >>> 0).toString(36);
  };
  const tracks = new Set(trackIndexes);
  const names = [];
  const tags = [];
  const full = [];
  const loose = [];
  for (const element of elements) {
    const classes = (element.getAttribute("class") ?? "").trim();
    names.push(`${element.id ? `#${element.id}` : ""}${classes ? `.${classes.split(/\s+/u).join(".")}` : ""}` || element.tagName.toLowerCase());
    tags.push(element.tagName);
    const readings = read(element);
    const where = box(element);
    full.push(`${where} ${readings.map((values) => hash(values.join(";"))).join(" ")}`);
    loose.push(`${where} ${readings.map((values) => hash(values.filter((_value, at) => !tracks.has(at)).join(";"))).join(" ")}`);
  }
  return { names, tags, full, loose };
}
