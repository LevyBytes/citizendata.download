export function json(body, status = 200) {
  return { status, contentType: "application/json", body };
}

export function html(body, bodyAttributes = "") {
  return { status: 200, contentType: "text/html; charset=UTF-8", body: `<!doctype html><html><head><title>Synthetic RSI</title></head><body${bodyAttributes}>${body}</body></html>` };
}

export function redirect(location) {
  return { status: 302, contentType: "text/html", body: "", location };
}

export function paged(rows, page, size) {
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  return { pageCount, rows: rows.slice((page - 1) * size, page * size) };
}

export function fragment(rows, page, size, render) {
  const slice = paged(rows, page, size);
  if (page > slice.pageCount) return json({ success: 0, code: "ErrPageOutOfRange", data: null });
  return json({ success: 1, data: { page, pagecount: slice.pageCount, rendered: slice.rows.map(render).join("") } });
}
