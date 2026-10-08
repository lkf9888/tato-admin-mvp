/**
 * Spread onto every search box: `<input type="search" {...SEARCH_FIELD_PROPS} />`.
 *
 * Password managers read a lone text field near the top of a page as a
 * username box and fill the signed-in email into it -- so a page opened
 * its order list already filtered by the admin's own address, and found
 * nothing. Each manager has its own opt-out; this is all of them, plus
 * the browser's own autofill and autocorrect.
 */
export const SEARCH_FIELD_PROPS = {
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
  "data-1p-ignore": true,
  "data-lpignore": "true",
  "data-bwignore": true,
  "data-form-type": "other",
} as const;
