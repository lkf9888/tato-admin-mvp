export const ADMIN_ROUTES = [
  "/dashboard",
  "/vehicles",
  "/owners",
  "/orders",
  "/calendar",
  "/imports",
  "/share-links",
] as const;

export const sourceOptions = [
  { value: "turo", label: "Turo" },
  { value: "offline", label: "Offline" },
] as const;

export const orderStatusOptions = [
  { value: "booked", label: "Booked" },
  { value: "ongoing", label: "Ongoing" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
] as const;

export const vehicleStatusOptions = [
  { value: "available", label: "Available" },
  { value: "maintenance", label: "Maintenance" },
  { value: "inactive", label: "Inactive" },
] as const;

export const shareVisibilityOptions = [
  { value: "standard", label: "Standard" },
  { value: "privacy", label: "Privacy" },
] as const;

export const csvFieldOptions = [
  { value: "vehicleLabel", label: "Vehicle / Plate label" },
  { value: "vehicleName", label: "Vehicle name" },
  { value: "externalVehicleId", label: "Vehicle id" },
  { value: "vin", label: "VIN" },
  { value: "renterName", label: "Guest / Renter name" },
  { value: "renterPhone", label: "Phone" },
  { value: "pickupDatetime", label: "Trip Start" },
  { value: "returnDatetime", label: "Trip End" },
  { value: "pickupLocation", label: "Pickup location" },
  { value: "returnLocation", label: "Return location" },
  { value: "tripPrice", label: "Trip price" },
  { value: "totalEarnings", label: "Total earnings" },
  { value: "totalPrice", label: "Fallback total price" },
  { value: "externalOrderId", label: "Reservation ID" },
  { value: "status", label: "Trip status" },
] as const;

export const demoCredentials = {
  email: process.env.ADMIN_EMAIL ?? "admin@local.test",
  password: process.env.ADMIN_PASSWORD ?? "admin123",
};
