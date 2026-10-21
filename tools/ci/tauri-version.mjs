#!/usr/bin/env node
// tauri-version.mjs — print the `version` field of a Tauri config file.
//
// tauri.conf.json in this repo is JSONC: it legally contains // and /* */
// comments (see apps/desktop/src-tauri/tauri.conf.json — the updater note),
// so a plain require()/JSON.parse on the raw file throws. This helper
// strips comments string-safely (comment markers inside string literals
// are preserved), parses the result, and prints `.version`.
//
// Usage: node tools/ci/tauri-version.mjs <path-to-tauri.conf.json>
// Exit 1 with a clear stderr message when the file is unreadable, the JSON
// is invalid after stripping, or `version` is missing/empty.

import { readFileSync } from "node:fs";

function stripJsoncComments(text) {
  let out = "";
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        // keep the escaped character verbatim
        if (i + 1 < text.length) out += text[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      // line comment — skip to (but keep) the newline
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      // block comment — skip to the closing */
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

const path = process.argv[2];
if (!path) {
  console.error("tauri-version: usage: node tools/ci/tauri-version.mjs <tauri.conf.json>");
  process.exit(1);
}

let raw;
try {
  raw = readFileSync(path, "utf8");
} catch (err) {
  console.error(`tauri-version: cannot read ${path}: ${err.message}`);
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(stripJsoncComments(raw));
} catch (err) {
  console.error(`tauri-version: ${path} is not valid JSON/JSONC: ${err.message}`);
  process.exit(1);
}

const version = parsed?.version;
if (typeof version !== "string" || version.trim() === "") {
  console.error(`tauri-version: ${path} has no top-level string "version"`);
  process.exit(1);
}

process.stdout.write(version.trim());
