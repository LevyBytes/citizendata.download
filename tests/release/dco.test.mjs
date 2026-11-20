import assert from "node:assert/strict";
import test from "node:test";
import { hasSignOff } from "../../scripts/check-dco.mjs";

test("a commit is signed off only by a Signed-off-by line that names its author", () => {
  const author = { name: "Example Author", email: "author@example.org" };
  assert.equal(hasSignOff({ ...author, message: "Subject\n\nBody.\n\nSigned-off-by: Example Author <author@example.org>\n" }), true);
  assert.equal(hasSignOff({ ...author, message: "Subject\r\n\r\nSigned-off-by: Example Author <AUTHOR@example.org>\r\n" }), true);
  assert.equal(hasSignOff({ ...author, message: "Subject\n\nSigned-off-by: Someone Else <else@example.org>\nSigned-off-by: Example Author <author@example.org>" }), true);
  assert.equal(hasSignOff({ ...author, message: "Subject\n\nBody." }), false);
  assert.equal(hasSignOff({ ...author, message: "Subject\n\nSigned-off-by: Someone Else <else@example.org>" }), false);
  assert.equal(hasSignOff({ ...author, message: "Subject\n\nSigned-off-by: Example Author" }), false);
  assert.equal(hasSignOff({ ...author, message: "Subject\n\n  Signed-off-by: Example Author <author@example.org>" }), false);
  assert.equal(hasSignOff({ ...author, message: "Signed-off-by: Example Author <author@example.org> and more" }), false);
});
