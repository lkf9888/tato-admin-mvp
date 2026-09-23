/**
 * The car sharing agreement, as it exists on paper.
 *
 * Transcribed from the operator's own template. The clause wording is
 * reproduced verbatim and is not ours to improve: it is the text a
 * renter is agreeing to, and a paraphrase that reads better is a
 * different contract.
 *
 * One deliberate omission. The paper form ends with boxes for the
 * front of a credit card and its CVV. Those are not reproduced here
 * and no field collects them: storing a card number is PCI-regulated
 * and storing a CVV is prohibited outright, with no exception for
 * internal use. The clause requiring the renter to provide a payment
 * method for subsequent charges is kept -- the method itself is the
 * card already held by the payment processor, which is what the
 * agreement records instead.
 */

export type RentalAgreementClause = {
  heading: string;
  body: string;
};

export const RENTAL_AGREEMENT_TITLE = "CAR SHARING AGREEMENT";

export const RENTAL_AGREEMENT_CLAUSES: RentalAgreementClause[] = [
  {
    heading: "Use of Vehicle",
    body:
      "The Renter is granted permission to operate the vehicle strictly in accordance with the terms of this Agreement. Any use outside the agreed terms shall be deemed unauthorized. The Renter represents and warrants: Holds a valid driver's license. No major violations (DUI, suspension, etc.) Meets insurance eligibility. Any misrepresentation voids permission to use the vehicle.",
  },
  {
    heading: "Maximum Daily Mileage",
    body:
      "The maximum mileage can be driven is 100 KM per Day, and an additional $0.12/km will be charged for any excess.",
  },
  {
    heading: "Insurance",
    body:
      "Rentals do not include any insurance, renters will need to provide driver's license information to confirm the actual price of insurance for the vehicle, the rental company will charge the renter the cost of insurance based on ICBC's quote. The renter agrees to have their personal information added to the vehicle's ICBC insurance paper. In the event of an accident, the Renter agrees to notify the Rental Company immediately and to cooperate fully in any investigation. The Renter acknowledges that insurance coverage may be limited or void if terms are breached. The Renter agrees to pay any deductible resulting from an insurance claim and agrees to assume liability for uninsured parties in the event of an accident.",
  },
  {
    heading: "Vehicle Damage Responsibility",
    body:
      "The Renter is responsible for any damage/tickets to the vehicle during the term of the lease, whether or not the damage is caused by the renter's responsibility, and is liable for the full cost of repair by the insurance company; If mechanical or electronic parts of the vehicle are damaged as a result of the renter's driving errors, the renter is responsible for the full cost of repairs.",
  },
  {
    heading: "Renter's Claim Responsibility",
    body: "Renter must: Report to Owner immediately; Cooperate with ICBC / insurer;",
  },
  {
    heading: "Security Deposit",
    body:
      "The security deposit will be refunded within 2 weeks of the renter returning the vehicle, provided the renter has not caused any additional damage, unpaid rent or tickets to the vehicle or penalties.",
  },
  {
    heading: "Prohibited Activities",
    body:
      "No driving under the influence of alcohol or drugs; no driving without a valid license; no commercial use (including Uber or food delivery, unless permitted); no lending the vehicle to third parties. Use of the vehicle under prohibited conditions automatically voids coverage and permission.",
  },
  {
    heading: "No Smoking Policy",
    body:
      "Smoking of any kind (including cigarettes, cigars, vaping, or cannabis) is strictly prohibited inside the vehicle. A $150 cleaning fee will be deducted from the security deposit to any renter found in violation of this policy.",
  },
  {
    heading: "Vehicle Condition",
    body:
      "Renter to return the vehicle in the same condition, normal wear and tear excepted. Renters are required to ensure that the car is fully fueled when it is returned, if the car is not fueled when it is returned, the owner has the right to deduct the corresponding cost of fuel at the market price. Both parties shall exchange and compare all on-site photographs of the vehicle's condition upon pickup and return. Vehicle damage assessments shall be determined based solely on the before-and-after comparison photos. The vehicle owner retains the right to define the extent of damage.",
  },
  {
    heading: "Termination",
    body:
      "The Owner reserves the right to terminate the agreement for violation of terms without notice. If the car is being returned earlier than the rental end date, the total rental fee will still be charged according to the signed rental end date.",
  },
  {
    heading: "Liability and Obligations",
    body:
      "The Renter agrees to indemnify and hold harmless the Owner from any claims, damages, or liabilities arising from the use of the vehicle.",
  },
  {
    heading: "Entire Agreement",
    body:
      "This agreement constitutes the entire agreement between the parties, supersedes all prior negotiations, understandings, and agreements. The renter agrees to provide ID and credit card information for subsequent payments or compensation. After the renter's signature, the agreement becomes effective immediately. Even if the car is returned early, the rental fee will still be charged according to the contract terms.",
  },
];

export const RENTAL_AGREEMENT_DEFAULT_OWNER_ADDRESS =
  "2980 Number 3 Rd, Richmond, BC V6X 2B3";

/** Everything the header block can state about one booking. */
export type RentalAgreementFacts = {
  ownerName: string;
  ownerAddress: string;
  renterName: string;
  renterPhone: string;
  renterEmail: string;
  vehicleYear: string;
  vehicleMakeModel: string;
  vehicleVin: string;
  licensePlate: string;
  rentalStartDate: string;
  rentalEndDate: string;
  rentalPrice: string;
  securityDeposit: string;
  insuranceFee: string;
  paymentMethodOnFile: string;
};

function factLine(label: string, value: string) {
  const clean = value.trim();
  // A blank on paper is a line to fill in by hand. A blank here is a
  // fact the booking did not carry, and printing "VIN:" with nothing
  // after it just invites somebody to wonder what is missing.
  return clean ? `${label}: ${clean}` : null;
}

/**
 * The agreement as flowing text, ready for the PDF renderer.
 *
 * Kept as text rather than a fixed-position layout so the operator can
 * open it in the contract template editor afterwards and change a
 * clause without needing a PDF tool.
 */
export function buildRentalAgreementContent(facts: RentalAgreementFacts) {
  const header = [
    factLine("Owner", facts.ownerName),
    factLine("Owner's Address", facts.ownerAddress),
    factLine("Renter's Name", facts.renterName),
    factLine("Phone Number", facts.renterPhone),
    factLine("Email", facts.renterEmail),
    factLine("Rental Vehicle", `${facts.vehicleYear} ${facts.vehicleMakeModel}`.trim()),
    factLine("VIN", facts.vehicleVin),
    factLine("License Plate", facts.licensePlate),
    factLine("Rental Start Date", facts.rentalStartDate),
    factLine("Rental End Date", facts.rentalEndDate),
    factLine("Rental Price", facts.rentalPrice),
    factLine("Security Deposit", facts.securityDeposit),
    factLine("ICBC Insurance", facts.insuranceFee),
    factLine("Payment Method on File", facts.paymentMethodOnFile),
  ].filter(Boolean);

  const clauses = RENTAL_AGREEMENT_CLAUSES.map(
    (clause) => `${clause.heading}\n${clause.body}`,
  );

  return [header.join("\n"), ...clauses].join("\n\n");
}
