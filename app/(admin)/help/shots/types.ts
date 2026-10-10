/**
 * What the help manual's screenshot script shoots, and where it draws
 * the numbered marks. Shared by both languages: a label to find is given
 * as { zh, en }, and the marks it finds are stored per language in
 * marks.json, because the same button sits in a different place when its
 * words are longer.
 */

export type Label = string | { zh: string; en: string };

/** How to find one element on the page. The first visible match wins. */
export type Target = {
  /** An accessible role and a name the element's name contains. */
  role?: "button" | "link" | "tab" | "checkbox" | "radio" | "textbox" | "combobox" | "heading" | "group" | "menuitem" | "option";
  name?: Label;
  /** Visible text the element contains. */
  text?: Label;
  placeholder?: Label;
  css?: string;
  /** Exact text or name instead of "contains". */
  exact?: boolean;
  /** Which visible match, counting from 0. */
  nth?: number;
  /** The last visible match instead. */
  last?: boolean;
};

export type Action =
  | { click: Target }
  | { fill: Target; value: string }
  | { check: Target }
  | { press: string }
  | { wait: number }
  /** Scroll the page so this element sits near the top of the screen. */
  | { scrollTo: Target }
  /** Pick days on one car's calendar row: offsets from today. */
  | { pickDays: { plate: string; days: number[] } };

export type Shot = {
  /** Also the file name: public/help/shots/<zh|en>/<id>.jpg. */
  id: string;
  path: string;
  setup?: Action[];
  /** A taller window, for a page whose parts belong in one picture. */
  viewportHeight?: number;
  /** Default: the page beside the sidebar, one screen tall. */
  clip?: { element: Target; pad?: number } | { dialog: true; pad?: number };
  /** Numbered boxes; `step` is the step it illustrates, counted from 1. */
  marks: Array<{ step: number; target: Target }>;
};

/** What the script writes per shot and language: boxes as % of the image. */
export type ShotMarks = {
  width: number;
  height: number;
  marks: Array<{ step: number; x: number; y: number; w: number; h: number }>;
};
