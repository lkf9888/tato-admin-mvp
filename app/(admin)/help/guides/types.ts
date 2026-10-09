/** One page's guide in the help manual. */
export type Guide = {
  /** The page it explains, as its path without the slash -- also the
   *  screenshot's file name: public/help/pages/<set>/<key>.jpg. */
  key: string;
  title: string;
  /** One or two sentences: what this page is for. */
  summary: string;
  sections: Array<{ heading: string; steps: string[] }>;
  tips?: string[];
};

/** The manual's own words, beside the guides. */
export type HelpCopy = {
  title: string;
  intro: string;
  pick: string;
  open: string;
  steps: string;
  tips: string;
  /** "{page}" is replaced by the guide's title. Plain strings only: this
   *  crosses from the server page to a client component. */
  screenshotAlt: string;
  screenshotNote: string;
  contactTitle: string;
  contactBody: string;
};
