/**
 * The TATO mark.
 *
 * A "T" whose crossbar is a timeline row: one booking, then the next,
 * meeting flush the way bars do on the calendar. That is literally
 * what the product is -- cars down the side, bookings across the days
 * -- and it is a shape no other rental tool's logo arrives at, because
 * most of them draw a car.
 *
 * The colour changes at x=282, which is exactly the stem's right edge,
 * so the split is a consequence of the letter rather than a decision
 * about where to put some purple. An earlier version floated the
 * accent as a separate pill with a gap before it; at 32px that reads
 * as a notification dot, which is worse than no accent at all.
 *
 * The bars carry the same pill radius as the calendar's own booking
 * bars, so the icon on a home screen and the thing it opens are
 * recognisably the same object.
 */

/**
 * One set of numbers, two renderers.
 *
 * The app draws this as SVG; `app/icon.tsx` has to draw it as divs,
 * because Satori -- what `ImageResponse` renders with -- supports the
 * box model far more completely than it supports SVG paths. Sharing
 * the geometry is what keeps the launcher icon and the sidebar from
 * drifting into two different logos.
 *
 * Everything sits inside a centred circle of ~410px, the safe area
 * Android crops adaptive icons to: a launcher may shave the corners of
 * this tile without touching the mark.
 */
export const BRAND_MARK = {
  box: 512,
  ink: "#111318",
  accent: "#593CFB",
  tileRadius: 112,
  /** Crossbar, full span. Split by colour, not by a gap. */
  bar: { x: 106, y: 132, width: 300, height: 52, radius: 26 },
  /** Where white gives way to accent — the stem's right edge. */
  split: 282,
  stem: { x: 230, y: 132, width: 52, height: 248, radius: 26 },
} as const;

export function BrandMark({
  size = 32,
  rounded = true,
  className,
}: {
  size?: number;
  /** The tile's own corner radius. Android masks adaptive icons
   *  itself, so the launcher icon passes `rounded={false}` and lets
   *  the system decide circle, squircle or square. */
  rounded?: boolean;
  className?: string;
}) {
  const { box, ink, accent, tileRadius, bar, split, stem } = BRAND_MARK;
  const barEnd = bar.x + bar.width;
  // The accent tail: straight where it meets the white, capped round
  // at the far end so the crossbar keeps one continuous silhouette.
  const capCentre = barEnd - bar.radius;
  const tail = `M ${split} ${bar.y} H ${capCentre} A ${bar.radius} ${bar.radius} 0 0 1 ${capCentre} ${
    bar.y + bar.height
  } H ${split} Z`;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${box} ${box}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="TATO"
    >
      <rect width={box} height={box} rx={rounded ? tileRadius : 0} fill={ink} />
      <rect
        x={bar.x}
        y={bar.y}
        width={bar.width}
        height={bar.height}
        rx={bar.radius}
        fill="#FFFFFF"
      />
      <path d={tail} fill={accent} />
      <rect
        x={stem.x}
        y={stem.y}
        width={stem.width}
        height={stem.height}
        rx={stem.radius}
        fill="#FFFFFF"
      />
    </svg>
  );
}
