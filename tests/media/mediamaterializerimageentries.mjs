// Image entries for the image run's pace and provenance tests.
import { png } from "./media-materializer-in-a-sandbox.mjs";

export const plain = (value) => JSON.parse(JSON.stringify(value));

export const url = (index) => `https://media.robertsspaceindustries.com/${index}.png`;

export const entry = (index) => ({ normalizedUrl: url(index), imageKey: String(index % 10).repeat(64), sourceImageKeys: [], title: `Image ${index}`, references: [{ recordType: "pledge", recordKey: `p${index}`, role: "thumbnail" }] });

export const imagesFor = (count) => new Map(Array.from({ length: count }, (_, index) => [url(index), png(2 + index, 3)]));
