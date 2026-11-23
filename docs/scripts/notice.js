(() => {
  "use strict";

  // The x on the temporary header notice hides the notice until the page is loaded again. Nothing is stored, so the
  // notice returns on every refresh.
  const row = document.querySelector(".notice-row");
  const close = document.getElementById("noticeClose");
  if (!row || !close) return;
  close.addEventListener("click", () => {
    const hadFocus = document.activeElement === close;
    row.hidden = true;
    // Keyboard users land on the next control in the header instead of the top of the page.
    if (hadFocus) document.querySelector(".top-actions .button")?.focus();
  });
})();
