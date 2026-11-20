(function initializeCitizenDataBillingExtractors(root, factory) {
  "use strict";

  const api = factory();
  root.CitizenDataBillingExtractors = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataBillingExtractors() {
  "use strict";

  function clean(value) {
    return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
  }

  function text(node, selector) {
    return clean(node?.querySelector(selector)?.textContent);
  }

  function moneyFrom(value) {
    const source = clean(value).replace(/,/gu, "");
    const match = /^(\$|\u00a4)?\s*(-?)([0-9]+)(?:\.([0-9]{1,4}))?\s*([A-Z]{3})?$/iu.exec(source);
    if (!match) return null;
    const currency = match[5]?.toUpperCase() ?? (match[1] === "$" ? "USD" : null);
    if (!currency) return null;
    const integer = match[3].replace(/^0+(?=[0-9])/u, "");
    const minimumFractionDigits = ["USD", "EUR", "GBP"].includes(currency) ? 2 : 0;
    const fraction = (match[4] ?? "").padEnd(minimumFractionDigits, "0");
    return { amount: `${match[2]}${integer}${fraction ? `.${fraction}` : ""}`, currency };
  }

  function decimalFrom(value) {
    const match = /-?[0-9]+(?:\.[0-9]+)?/u.exec(clean(value).replace(/,/gu, ""));
    return match ? match[0] : null;
  }

  function labelledValue(node, label) {
    const normalized = label.toLowerCase();
    for (const candidate of node.querySelectorAll(".col, .s-row, p, dd")) {
      const labelNode = candidate.querySelector("span, strong, dt");
      if (clean(labelNode?.textContent).toLowerCase().replace(/:$/u, "") !== normalized) continue;
      const clone = candidate.cloneNode(true);
      clone.querySelector("span, strong, dt")?.remove();
      return clean(clone.textContent);
    }
    return null;
  }

  function labelledStrongValue(node, label) {
    const normalized = label.toLowerCase();
    for (const labelNode of node.querySelectorAll("strong")) {
      if (clean(labelNode.textContent).toLowerCase().replace(/:$/u, "") !== normalized) continue;
      let value = "";
      for (let sibling = labelNode.nextSibling; sibling; sibling = sibling.nextSibling) {
        const tagName = typeof sibling.tagName === "string" ? sibling.tagName.toUpperCase() : "";
        if (tagName === "BR" || tagName === "STRONG") break;
        value += sibling.textContent ?? "";
      }
      const result = clean(value);
      if (result) return result;
    }
    return null;
  }

  function imageRecords(node, role, baseUrl) {
    const output = [];
    const seen = new Set();
    for (const image of node.querySelectorAll("img[src], img[data-src]")) {
      const source = image.getAttribute("src") || image.getAttribute("data-src");
      if (!source) continue;
      let url;
      try { url = new URL(source, baseUrl); } catch { continue; }
      if (url.protocol !== "https:" || url.hostname === "robertsspaceindustries.com" && url.pathname === "/") continue;
      url.hash = "";
      if (seen.has(url.href)) continue;
      seen.add(url.href);
      output.push({ url: url.href, role, altText: clean(image.alt) || null, width: image.naturalWidth || null, height: image.naturalHeight || null });
    }
    return output;
  }

  function relatedUrls(node, baseUrl, extra = []) {
    const output = [];
    for (const candidate of [...extra, ...Array.from(node?.querySelectorAll?.("a[href]") ?? [], (link) => link.getAttribute("href"))]) {
      if (!candidate) continue;
      let url;
      try { url = new URL(candidate, baseUrl); } catch { continue; }
      if (url.protocol !== "https:" || url.username || url.password) continue;
      url.hash = "";
      if (!output.includes(url.href)) output.push(url.href);
    }
    return output;
  }

  function extractBalances(document) {
    const entries = Array.from(document.querySelectorAll(".credits .credit-line"));
    const find = (className, unit) => {
      const entry = entries.find((candidate) => className ? candidate.classList.contains(className) : !candidate.classList.contains("uec") && !candidate.classList.contains("rec"));
      const amount = decimalFrom(entry?.querySelector("em")?.textContent);
      return amount === null ? null : { amount, unit };
    };
    return { storeCredit: find(null, "USD"), uec: find("uec", "UEC"), rec: find("rec", "REC") };
  }

  function extractBillingTotal(document) {
    for (const line of document.querySelectorAll(".spent-line")) {
      if (!/\btotal\s+spent\b/iu.test(clean(line.textContent))) continue;
      const total = moneyFrom(text(line, "em"));
      if (total) return total;
    }
    return null;
  }

  function extractSubscriptions(document, baseUrl) {
    const records = [];
    const wrappers = document.querySelectorAll(".subscriptions-wrapper, .ended-sub .subscription, .subscription-history .subscription");
    for (const [index, wrapper] of Array.from(wrappers).entries()) {
      const plan = text(wrapper, ".badge h3") || text(wrapper, "h3") || `Subscription ${index + 1}`;
      const subscriptionId = labelledValue(wrapper, "Subscription ID") || wrapper.getAttribute("data-subscription-id") || `unknown-${index + 1}`;
      const totalPaid = moneyFrom(labelledValue(wrapper, "Total paid"));
      const amount = moneyFrom(labelledValue(wrapper, "Amount"));
      const ended = Boolean(totalPaid || /ended|expired/iu.test(clean(wrapper.textContent)));
      const payments = [];
      for (const row of wrapper.querySelectorAll("table tr")) {
        const cells = Array.from(row.querySelectorAll("td"), (cell) => clean(cell.textContent));
        if (cells.length < 4) continue;
        const paymentAmount = moneyFrom(cells[3]);
        if (!paymentAmount) continue;
        payments.push({ rawTimestamp: cells[0], processor: cells[1] || null, status: cells[2] || "unknown", amount: paymentAmount });
      }
      records.push({
        subscriptionId,
        plan,
        state: ended ? "ended" : "active",
        startDateRaw: labelledValue(wrapper, "Start date") || labelledValue(wrapper, "Started") || "Unknown",
        endDateRaw: labelledValue(wrapper, "End date") || labelledValue(wrapper, "Ended") || null,
        recurringState: labelledValue(wrapper, "Recurring"),
        amount,
        totalPaid,
        totalTimeRaw: labelledValue(wrapper, "Total time"),
        payments,
        images: imageRecords(wrapper, "subscription", baseUrl),
        relatedUrls: relatedUrls(wrapper, baseUrl, [baseUrl])
      });
    }
    return records;
  }

  function extractOrders(document, baseUrl) {
    const records = [];
    for (const row of document.querySelectorAll("ul.orders-item > li")) {
      const basic = row.querySelector(".basic-infos") ?? row;
      const orderId = labelledValue(basic, "Order Id");
      if (!orderId) continue;
      const hasShipping = Boolean(row.querySelector(".ship-to"));
      const items = [];
      for (const itemRow of row.querySelectorAll("table.billing-summary tr")) {
        const cells = Array.from(itemRow.querySelectorAll("td"), (cell) => clean(cell.textContent));
        if (cells.length < 5) continue;
        const unitPrice = moneyFrom(cells[1]);
        const discount = moneyFrom(cells[3]);
        const total = moneyFrom(cells[4]);
        if (!unitPrice || !discount || !total) continue;
        items.push({ name: cells[0], unitPrice, quantity: Number(cells[2]) || 1, discount, total, physical: hasShipping, trackingAvailable: /track/iu.test(clean(row.textContent)), images: imageRecords(itemRow, "order-item", baseUrl), relatedUrls: relatedUrls(itemRow, baseUrl) });
      }
      const payments = [];
      for (const paymentRow of row.querySelectorAll(".payment-wrapper table tr")) {
        const cells = Array.from(paymentRow.querySelectorAll("td"), (cell) => clean(cell.textContent));
        if (cells.length < 4) continue;
        const amount = moneyFrom(cells[3]);
        if (amount) payments.push({ rawTimestamp: cells[0], processor: cells[1] || null, status: cells[2] || "unknown", amount });
      }
      const total = moneyFrom(labelledValue(basic, "Amount")) ?? moneyFrom(text(row, ".s-row.last")) ?? { amount: "0.00", currency: "USD" };
      records.push({
        orderId,
        placedAtRaw: labelledValue(basic, "Order Placed") || "Unknown",
        storefront: clean(row.querySelector(".storefront .active, .storefront li.active, .storefront")?.textContent) || null,
        status: labelledValue(basic, "Status") || "unknown",
        paymentState: labelledValue(basic, "Payment"),
        fulfillmentState: labelledValue(basic, "Fulfillment"),
        physical: hasShipping,
        items,
        billingAddress: null,
        shippingAddress: null,
        itemsTotal: moneyFrom(labelledStrongValue(row, "Items")) ?? moneyFrom(text(row, ".right-section .s-row")) ?? total,
        additionalDiscount: moneyFrom(labelledStrongValue(row, "Additional discount")) ?? { amount: "0.00", currency: total.currency },
        creditsUsed: moneyFrom(labelledStrongValue(row, "Credits used")) ?? { amount: "0.00", currency: total.currency },
        shippingAndHandling: moneyFrom(labelledStrongValue(row, "Shipping & handling")) ?? moneyFrom(labelledStrongValue(row, "Shipping and handling")),
        tax: moneyFrom(labelledStrongValue(row, "Tax")),
        total,
        payments,
        invoiceAvailable: Boolean(row.querySelector(".js-print-invoice")),
        relatedUrls: relatedUrls(row, baseUrl, [baseUrl])
      });
    }
    return records;
  }

  function extractLedgerRows(document, baseUrl = "https://robertsspaceindustries.com/en/account/billing") {
    const records = [];
    for (const entry of document.querySelectorAll(".credit-log-rows .pledge-log-entry, .pledge-log-entry")) {
      const paragraph = entry.querySelector("p") ?? entry;
      const amountNode = paragraph.querySelector(".important ins, .important del, .important");
      const rawText = clean(paragraph.textContent);
      const rawAmount = clean(amountNode?.textContent);
      let amount = decimalFrom(rawAmount);
      if (!amount) continue;
      if (amountNode?.matches("del") && !amount.startsWith("-")) amount = `-${amount}`;
      const amountOffset = rawAmount ? rawText.indexOf(rawAmount) : -1;
      const rawTimestamp = amountOffset >= 0 ? clean(rawText.slice(0, amountOffset)) : "Unknown";
      const rawDetail = amountOffset >= 0 ? clean(rawText.slice(amountOffset + rawAmount.length).replace(/^\s*-\s*/u, "")) : rawText;
      records.push({ rawTimestamp, amount, rawDetail, parsed: { recognized: false }, relatedUrls: relatedUrls(entry, baseUrl, [baseUrl]) });
    }
    return records;
  }

  function pageCount(document, currentPage = 1) {
    let maximum = currentPage;
    for (const link of document.querySelectorAll(".pager a[href]")) {
      try {
        const page = Number(new URL(link.getAttribute("href"), "https://robertsspaceindustries.com").searchParams.get("page"));
        if (Number.isSafeInteger(page) && page > maximum) maximum = page;
      } catch {
        // Ignore malformed pagination links.
      }
    }
    return maximum;
  }

  return Object.freeze({ extractBalances, extractBillingTotal, extractLedgerRows, extractOrders, extractSubscriptions, pageCount });
});
