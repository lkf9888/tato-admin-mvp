/** One page's guide in the help manual. */
export type Guide = {
  /** The page it explains, as its path without the slash. */
  key: string;
  title: string;
  /** One or two sentences: what this page is for. */
  summary: string;
  /** `shot` names a picture in app/(admin)/help/shots: its numbered marks
   *  point at the steps with the same numbers. */
  sections: Array<{ heading: string; shot?: string; steps: string[] }>;
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
  close: string;
  contactTitle: string;
  contactBody: string;
};

/** A section's picture, ready to draw: where it is and its marks. */
export type ResolvedShot = {
  src: string;
  width: number;
  height: number;
  marks: Array<{ step: number; x: number; y: number; w: number; h: number }>;
};

export type ResolvedGuide = Omit<Guide, "sections"> & {
  sections: Array<{ heading: string; shot: ResolvedShot | null; steps: string[] }>;
};
