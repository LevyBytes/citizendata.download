(function exposeCitizenDataFileTimestamp(root, factory) {
  "use strict";
  const api = factory();
  root.CitizenDataFileTimestamp = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataFileTimestamp() {
  "use strict";
  function format(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "undated-000000-000Z";
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/u.exec(date.toISOString());
    return `${match[1]}-${match[2]}${match[3]}${match[4]}-${match[5]}Z`;
  }
  return Object.freeze({ format });
});
