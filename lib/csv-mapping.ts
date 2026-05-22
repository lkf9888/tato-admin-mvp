export function guessCsvField(header: string) {
  const normalized = header.trim().toLowerCase();
  if (
    normalized === "reservation" ||
    normalized === "reservation id" ||
    normalized === "trip" ||
    normalized === "trip id" ||
    normalized === "booking id" ||
    normalized === "confirmation code"
  ) {
    return "externalOrderId";
  }
  if (normalized === "vehicle" || normalized === "listing") return "vehicleLabel";
  if (normalized === "vehicle name" || normalized === "nickname" || normalized === "car") {
    return "vehicleName";
  }
  if (normalized === "vehicle id" || normalized === "listing id" || normalized === "car id") {
    return "externalVehicleId";
  }
  if (normalized === "vin") return "vin";
  if (
    normalized === "guest" ||
    normalized === "guest name" ||
    normalized === "renter" ||
    normalized === "renter name" ||
    normalized === "driver" ||
    normalized === "driver name"
  ) {
    return "renterName";
  }
  if (normalized.includes("phone")) return "renterPhone";
  if (normalized.includes("pickup location") || normalized.includes("pick-up location")) {
    return "pickupLocation";
  }
  if (normalized.includes("return location") || normalized.includes("drop-off location")) {
    return "returnLocation";
  }
  if (
    normalized.includes("trip start") ||
    normalized === "start" ||
    normalized === "start date" ||
    normalized === "start datetime" ||
    normalized === "pickup datetime" ||
    normalized === "pickup time" ||
    normalized === "pickup" ||
    normalized.includes("pick-up time")
  ) {
    return "pickupDatetime";
  }
  if (
    normalized.includes("trip end") ||
    normalized === "end" ||
    normalized === "end date" ||
    normalized === "end datetime" ||
    normalized === "return datetime" ||
    normalized === "return time" ||
    normalized === "return" ||
    normalized.includes("drop-off time")
  ) {
    return "returnDatetime";
  }
  if (normalized === "trip price") return "tripPrice";
  if (normalized === "total earnings") return "totalEarnings";
  if (normalized.includes("earning") || normalized.includes("payout")) return "totalPrice";
  if (normalized === "price" || normalized === "total price" || normalized === "total") {
    return "totalPrice";
  }
  if (normalized.includes("trip status") || normalized === "status") return "status";
  return "";
}

export function buildCsvHeaderMapping(headers: string[]) {
  return Object.fromEntries(headers.map((header) => [header, guessCsvField(header)]));
}
