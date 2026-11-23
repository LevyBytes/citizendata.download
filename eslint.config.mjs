// ESLint for this repository. It imports no package: the rules and the names each part of the code may rely on are
// written out here, so the check is the same wherever ESLint is installed. Run by `npm run lint`.

// ESLint's own recommended rules, each as an error.
const RECOMMENDED = `constructor-super for-direction getter-return no-async-promise-executor no-case-declarations no-class-assign no-compare-neg-zero
  no-cond-assign no-const-assign no-constant-binary-expression no-constant-condition no-control-regex no-debugger no-delete-var no-dupe-args
  no-dupe-class-members no-dupe-else-if no-dupe-keys no-duplicate-case no-empty no-empty-character-class no-empty-pattern no-empty-static-block
  no-ex-assign no-extra-boolean-cast no-fallthrough no-func-assign no-global-assign no-import-assign no-invalid-regexp no-irregular-whitespace
  no-loss-of-precision no-misleading-character-class no-new-native-nonconstructor no-nonoctal-decimal-escape no-obj-calls no-octal
  no-prototype-builtins no-redeclare no-regex-spaces no-self-assign no-setter-return no-shadow-restricted-names no-sparse-arrays
  no-this-before-super no-unassigned-vars no-undef no-unexpected-multiline no-unreachable no-unsafe-finally no-unsafe-negation
  no-unsafe-optional-chaining no-unused-labels no-unused-private-class-members no-unused-vars no-useless-assignment no-useless-backreference
  no-useless-catch no-useless-escape no-with preserve-caught-error require-yield use-isnan valid-typeof`;

const rules = {
  ...Object.fromEntries(RECOMMENDED.split(/\s+/u).map((name) => [name, "error"])),
  // A name that begins with an underscore is left unused on purpose: a part of a destructuring that is taken out, or
  // an argument kept for its position.
  "no-unused-vars": ["error", { varsIgnorePattern: "^_", argsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }]
};

// The names a part of the code uses without defining them. A name that is not listed is an error there, so a new
// reliance on the browser, on Chrome, or on Node is added here on purpose.
const names = (list) => ({ globals: Object.fromEntries(list.split(/\s+/u).filter(Boolean).map((name) => [name, "readonly"])) });
// A script that also runs under Node for the tests hands its interface to `module.exports` when there is one.
const NODE_EXPORT = "module require";
const SYNCED_COPIES = ["account-document.js", "organization-document.js", "request-pacing-settings.js", "pace-controller.js", "pace-history.js"].flatMap((name) => [`docs/scripts/${name}`, `extension/shared/${name}`]);
// What the dashboard's scripts use of a page.
const PAGE = `AbortController Blob CustomEvent DOMException IntersectionObserver ResizeObserver TextDecoder TextEncoder URL clearTimeout crypto document fetch
  location matchMedia queueMicrotask sessionStorage setTimeout structuredClone window`;
// What the tests use of Node.
const NODE_TESTS = `AbortController AbortSignal Blob Buffer CompressionStream DOMException DecompressionStream TextDecoder TextEncoder URL URLSearchParams
  WebSocket atob btoa clearTimeout console crypto fetch performance process setImmediate setTimeout structuredClone`;
// What the functions use that a browser check hands to the page and runs there.
const PAGE_PROBES = "CSS HTMLDialogElement Node SVGElement document getComputedStyle innerHeight innerWidth isSecureContext requestAnimationFrame scrollX scrollY";

export default [
  // The copies `npm run sync:schemas` writes are checked where they are written from (`shared/`, `schema/`);
  // `npm run check:schemas` proves each copy equal to its source.
  { ignores: ["**/node_modules/**", "dist/**", "**/work-temp-*/**", "docs/schema/**", "extension/schema/**", ...SYNCED_COPIES] },
  { files: ["**/*.js", "**/*.mjs"], linterOptions: { reportUnusedDisableDirectives: "error" }, languageOptions: { ecmaVersion: "latest", sourceType: "module" }, rules },

  // The extension, the dashboard and the sources they share are loaded as classic scripts, not as modules.
  { files: ["extension/**/*.js", "platform/**/*.js", "docs/scripts/**/*.js", "shared/**/*.js"], languageOptions: { sourceType: "script" } },
  { files: ["shared/**/*.js"], languageOptions: names(`TextEncoder URL ${NODE_EXPORT}`) },
  { files: ["docs/scripts/**/*.js"], languageOptions: names(`${PAGE} ${NODE_EXPORT}`) },
  { files: ["platform/chromium/service-worker.js"], languageOptions: names("TextEncoder URL chrome crypto importScripts structuredClone") },
  { files: ["extension/adapters/**/*.js"], languageOptions: names(`AbortController TextEncoder URL chrome clearTimeout fetch setTimeout structuredClone ${NODE_EXPORT}`) },
  { files: ["extension/jobs/**/*.js"], languageOptions: names(`TextEncoder crypto setTimeout ${NODE_EXPORT}`) },
  { files: ["extension/storage/**/*.js"], languageOptions: names(`IDBKeyRange TextEncoder ${NODE_EXPORT}`) },
  { files: ["extension/shared/**/*.js"], languageOptions: names(`TextEncoder URL ${NODE_EXPORT}`) },
  { files: ["extension/content/**/*.js"], languageOptions: names("crypto location window") },
  { files: ["platform/chromium/offscreen/**/*.js"], languageOptions: names("DOMParser chrome") },
  { files: ["extension/popup/**/*.js"], languageOptions: names("Blob MutationObserver ResizeObserver URL chrome clearTimeout document matchMedia navigator setTimeout window") },

  // The tooling and the tests run under Node.
  { files: ["scripts/**/*.mjs", "*.mjs"], languageOptions: names("Buffer console process") },
  { files: ["tests/**/*.mjs", "tests/**/*.js"], languageOptions: names(`${NODE_TESTS} ${NODE_EXPORT}`) },
  // Browser checks hold functions that are handed to the page and run there.
  { files: ["tests/web/**/*.mjs"], languageOptions: names(`${NODE_TESTS} ${NODE_EXPORT} ${PAGE_PROBES}`) }
];
