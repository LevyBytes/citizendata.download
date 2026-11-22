export function json(body, status = 200) {
  return { status, contentType: "application/json", body };
}

export function html(body, bodyAttributes = "") {
  return { status: 200, contentType: "text/html; charset=UTF-8", body: `<!doctype html><html><head><title>Synthetic RSI</title></head><body${bodyAttributes}>${body}</body></html>` };
}

export function redirect(location) {
  return { status: 302, contentType: "text/html", body: "", location };
}

// The stand-in for RSI's answer to page 1 of an empty credit ledger (PARSER_HARDENING.md §13.2): a page count of 0.
// RSI's real answer is not on record; this is the one shape the extension reads as an empty ledger.
export const EMPTY_LEDGER_ANSWER = Object.freeze({ success: 1, code: "OK", msg: "OK", data: Object.freeze({ page: 1, pagecount: 0, rendered: "" }) });

export function paged(rows, page, size) {
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  return { pageCount, rows: rows.slice((page - 1) * size, page * size) };
}

export function fragment(rows, page, size, render) {
  const slice = paged(rows, page, size);
  if (page > slice.pageCount) return json({ success: 0, code: "ErrPageOutOfRange", data: null });
  return json({ success: 1, data: { page, pagecount: slice.pageCount, rendered: slice.rows.map(render).join("") } });
}
