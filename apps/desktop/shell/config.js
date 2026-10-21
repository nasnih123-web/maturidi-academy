// Maturidi Academy — desktop shell configuration (ADR-0023).
//
// MATURIDI_WEB_URL is the deployed production web origin the shell opens,
// e.g. "https://academy.example.com". It is set at PACKAGING / deployment
// time (edit this file inside the release bundle) — never in source control
// with a guessed value.
//
// Empty (default in the repo) = the shell shows its built-in
// "not configured" state page. The shell NEVER falls back to localhost or
// any placeholder URL in a production bundle.
window.MATURIDI_WEB_URL = "";
