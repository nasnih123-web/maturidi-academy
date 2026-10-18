/**
 * @maturidi/ui-native — Phase 3 scaffold.
 *
 * Native components land in a later phase. This entry only proves the
 * design-token contract is consumable outside the web: the same palette,
 * spacing, typography and radii from `@maturidi/design-tokens`, typed for
 * React Native StyleSheets. (Subpath import: the package intentionally
 * carries no `main`/`exports` yet — workspace linking lands with the
 * monorepo tooling in a later phase.)
 *
 * No business logic — pure presentation (§15, ADR 0002).
 */
export { tokens } from "@maturidi/design-tokens/tokens";
export type { Tokens } from "@maturidi/design-tokens/tokens";
