export const RSI_ORIGIN = "https://robertsspaceindustries.com";
export const HOSTED_ORIGIN = "https://citizendata.download";
export const MEDIA_ORIGIN = "https://media.robertsspaceindustries.com";
// RSI's status page and feed, answered by the synthetic account (PARSER_HARDENING.md §9.3).
export const STATUS_ORIGIN = "https://status.robertsspaceindustries.com";
// A 1 by 1 PNG. Each image address is answered with it followed by the address, so no two images share content.
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
export const TOKEN = "synthetic-session-token-0123456789";
export const STATE_KEY = "citizendata.runtime.v2";
export const WATCHDOG = "citizendata.watchdog";
export const mime = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".json": "application/json", ".xml": "application/xml", ".txt": "text/plain"
};
