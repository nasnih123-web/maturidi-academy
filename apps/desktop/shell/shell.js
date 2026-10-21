// Maturidi Academy — desktop shell logic (ADR-0023).
//
// The shell contains NO product logic. It only:
//   - reads MATURIDI_WEB_URL from config.js,
//   - navigates the webview to the real production web app when a valid
//     URL is configured and the machine is online,
//   - otherwise shows an honest built-in state page (not configured /
//     offline) with a retry action.
(function () {
  "use strict";

  var url = (window.MATURIDI_WEB_URL || "").trim();
  var isValid = /^https?:\/\/[^\s]+$/.test(url);

  var states = {
    loading: document.getElementById("state-loading"),
    offline: document.getElementById("state-offline"),
    unconfigured: document.getElementById("state-unconfigured"),
  };

  function show(name) {
    Object.keys(states).forEach(function (key) {
      if (states[key]) states[key].hidden = key !== name;
    });
  }

  function go() {
    if (!isValid) {
      show("unconfigured");
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      show("offline");
      return;
    }
    show("loading");
    window.location.replace(url);
  }

  var retry = document.getElementById("retry");
  if (retry) retry.addEventListener("click", go);
  window.addEventListener("online", go);

  go();
})();
