# Rental income estimator

Powers `/rental-estimate` in the admin nav (Fleet group), where you pick
a year/make/model and get twelve months of projected earnings — a desk
tool for answering an owner who asks what their car would make.

Everything runs client-side off two JSON files. No database query, no
network call to Turo — so the page has nothing to wait on, and it cannot
break when Turo changes their site.

| File | What it is | Maintained by |
| --- | --- | --- |
| `model.json` | Fitted coefficients, seasonal curves, per-model adjustments | `scripts/build-rental-estimate-model.ts` |
| `catalog.json` | 360 Canadian-market models → body segment + base MSRP (2024 CAD) | by hand |
| `index.ts` | `estimateVehicle()` — puts them back together | by hand |
| `report-canvas.ts` | Draws the one-page PDF report | by hand |
| `costs.ts` | Running-cost and reliability assumptions | by hand |
| `roi.ts` | `rankVehicles()` — which car is worth buying | by hand |

## What it's built from

5,789 completed Turo trips across 151 cars and 73 models, December 2023
to August 2026, **all of them rented in Metro Vancouver**. After
collapsing trips into vehicle-months and dropping stretches where a car
was off the market, 1,567 vehicle-months across 142 cars survive as the
fitting sample.

Trips are prorated across the calendar days they actually cover, so a
trip running 28 December to 4 January contributes to both months in
proportion. A vehicle-month counts only if the car was listed for at
least 12 days of it, and revenue is scaled up to a full month so a
partial first month doesn't read as a slow one.

Two or more consecutive zero-revenue months are treated as the car being
**parked**, not as failing to rent, and are dropped. Owners take cars
back for a month; counting that as demand would bias every estimate
downward by however often they do.

## The model

```
monthly earnings = exp(a + b·log(value)) × segment × model × season(month)
```

**`b = 0.42`.** Earnings rise with what a car is worth, but far less than
proportionally — double the value and earnings rise about 34%. This is
the single most consequential number here, and the reason a $6k Grand
Caravan beats a $57k Range Rover on return per dollar invested. It is
also why an error in the estimated car value costs less than half as
much in the output.

**Segment** is a body-style multiplier at equal value: minivans and
pickups about +9%, luxury sedans −11%, EVs −17%. Each one is shrunk
toward neutral by its own sample size (prior of 25 vehicle-months), so a
segment seen three times cannot carry the same authority as one seen
three hundred. Without that, `midsize` claimed a +19% bump inferred from
three vehicle-months and applied it to every Camry and Accord.

**Model** nudges toward what we actually saw, where we have run the
model ourselves, shrunk the same way (prior of 10 vehicle-months). The
page reports which of the two paths produced a given number.

**Season** is where most of the variance lives. July and August run
about 1.9× an average month, November about 0.5×, with a small December
bump. The shape repeated almost identically in 2024, 2025 and 2026, so
this is signal, not noise. Separate curves are fitted per body family
(small / suv / big / ev) and blended halfway toward the pooled curve;
the EV sample is too thin for its own and falls back to pooled.

**Value** comes from the catalogue's base MSRP carried to the model year
at 3.2%/year nominal, then depreciated: −18% the first year, −11.5%/year
after, floored at 8.5%. One number per model covers every year.

**Calibration.** The level is fitted on median log-residuals, which
predicts a *typical* month. A final scalar, measured over every
model-year with at least a year of history, pulls the central estimate
onto the observed average — it currently moves the answer by 0.3%,
which is a useful check that the fit was already well centred.

## Accuracy

Measured by holding out one car at a time and predicting it from the
other 141 (53 of them have a full year of history to score):

| | |
| --- | --- |
| Annual total, median error | 11.5% |
| Annual total, within 20% | 83% |
| Annual total, within 30% | 94% |
| Single month, MAE | ~25% of a median month |

Months swing wider than years because one long booking moves one month a
lot. The page shows a p25–p75 band alongside the point estimate for
exactly this reason.

Cross-checked against Turo's own published US figures ("Top-earning cars
on Turo"): for a Fiat 500 and a Chrysler Voyager the model lands within
about 10% of their numbers after currency conversion, from data that
shares no source with theirs.

## Refitting

```bash
npx tsx scripts/build-rental-estimate-model.ts ~/Downloads/turo-earnings
```

Point it at a directory of Turo "trip earnings export" CSVs — drop
overlapping exports in together, they're de-duplicated by reservation
ID. It rewrites `model.json` and prints a leave-one-vehicle-out
validation. **If the annual median error drifts well above ~12%, find
out what changed before shipping the new file.**

Models missing from `catalog.json` are listed and skipped, so the run
tells you what to add.

The accuracy figures quoted on the page are read out of `model.json` at
render time, so they follow a refit on their own. The prose describing
the elasticity and the segment multipliers is not — check
`lib/i18n/messages/rental-estimate.ts` against the script's output.

## The investment ranking

`/investment-ranking` scores every eligible model-year — about 3,300 of
them — on what it earns against what it costs to buy, run, repair and
eventually sell:

```
net cash = revenue − maintenance − repairs − fixed costs
total    = net cash − depreciation
```

Two inputs come from our own data. Revenue is the fitted income model.
Distance is measured: across 9.24 million kilometres of completed trips
a car covers ~115 km per rented day, and rented days are divided out of
predicted revenue at a fitted $/day curve, so a car that earns more
necessarily drives more and wears out faster. Median utilisation across
the fleet is 55%, about 200 days a year, and annual distance lands
between 21,000 and 30,000 km — 1.5-2x a private car, which is why
per-kilometre costs dominate here.

Everything else is a published average and is documented in
`costs.ts`. Repairs are the widest source of error; the worst case is
the one to plan against.

**The fixed costs are load-bearing.** Because revenue scales with value
at an elasticity below 0.5, return per dollar always favours cheap cars.
Insurance, parking and licensing are charged per car rather than per
dollar, and they are the only thing stopping the ranking from
degenerating into "buy as many of the cheapest eligible car as the
budget allows". Set them to what is actually paid.

Purchase price is the denominator of every ratio and the weakest input
in the model, so each row takes a typed price. An overridden row stays
visible with its true rank even when it falls out of the top of the
list — that is the whole point of typing a real quote in.

## The PDF report

"Download PDF" builds a one-page leave-behind for the owner who asked.
It is drawn onto a canvas and embedded as a bitmap in a `pdf-lib` page,
rather than laid out with pdf-lib's own text API, because that API's
standard fonts are Latin-1 only — `lib/contract-documents.ts` runs
every string through a `toWinAnsi` filter that turns anything outside
that range into `?`, so a Chinese report would come out as rows of
question marks. Embedding a CJK font instead means shipping ~10MB of
Noto in the repo and the image; the browser already has the fonts.

The trade is that the text is not selectable. For a one-page handout
that is a fair price, and it renders correctly in all three locales.

Both `report-canvas.ts` and `pdf-lib` load on click, not with the page —
most visits end with reading a number off the screen. Output is Letter
at 3x (~216 DPI), around 220KB.

## Eligibility

Turo Canada will not list a car older than **12 years**, so the year
picker only offers `currentYear - 12` and newer; `oldestEligibleYear()`
in `index.ts` rolls that bound with the calendar rather than pinning it.

The catalogue holds only models sold in Canada. It still carries models
now past the age limit — they are unreachable from the picker, but their
history is what anchors the cheap end of the value curve when the model
is refitted, so do not prune them.

## Adding to the catalogue

```json
"Toyota|Sienna": { "make": "Toyota", "model": "Sienna", "seg": "van", "msrp2024": 44000 }
```

`msrp2024` is the model's **base** MSRP in 2024 Canadian dollars, for a
model still sold; for a discontinued one, what its successor or nearest
equivalent costs now. Trim doesn't need to be precise — the 0.42
elasticity halves any error in it.

Segments: `econ` `compact` `midsize` `fullsize` `lux_car` `sport`
`cuv_s` `cuv_m` `suv_l` `van` `truck` `lux_suv` `ev`.

## What this is not

It is a Vancouver number, and only a Vancouver number. The seasonal
swing here is far sharper than in a year-round market, and nothing in
the fit would transfer to a city with different tourism.

It assumes full-time availability under our management, and it is gross
rental income — before insurance, financing, maintenance, cleaning,
parking, depreciation and tax. The page says so; keep it saying so.
