import bcrypt from "bcryptjs";

import { bootstrapAdminCredentials } from "../lib/constants";
import { prisma } from "../lib/prisma";

async function main() {
  await prisma.user.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.listingPhoto.deleteMany();
  await prisma.rentalListing.deleteMany();
  await prisma.order.deleteMany();
  await prisma.shareLink.deleteMany();
  await prisma.importBatch.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.owner.deleteMany();

  await prisma.user.create({
    data: {
      name: "Admin",
      email: bootstrapAdminCredentials.email.toLowerCase(),
      passwordHash: await bcrypt.hash(bootstrapAdminCredentials.password, 10),
    },
  });

  await prisma.rentalListing.createMany({
    data: [
      {
        publicId: "yaletown-demo",
        status: "published",
        title: "Yaletown Corner Condo With Warm Evening Light",
        propertyType: "Condo",
        neighborhood: "Yaletown",
        addressLine: "123 Mainland Street",
        city: "Vancouver",
        province: "BC",
        monthlyRent: 3450,
        bedrooms: 1,
        bathrooms: 1,
        areaSqft: 690,
        availableFrom: new Date("2026-05-01T12:00:00"),
        summary: "Bright one-bedroom home near the seawall with a clean layout, private balcony, and one underground parking stall.",
        description:
          "This first demo listing is meant to show the future structure of your public ad page. Use it to replace the sample copy with your real pricing, location notes, building amenities, and move-in details. The page is intentionally designed so renters land directly on one polished listing instead of browsing a public homepage.",
        highlights: "Corner exposure with sunset light\nPrivate balcony\n1 parking stall included",
        amenities: "Gym\nIn-suite laundry\nConcierge",
        petPolicy: "Small pets subject to approval",
        parkingInfo: "1 underground stall included",
        furnishedInfo: "Unfurnished",
        contactName: "Leasing Team",
        contactPhone: "604-555-0188",
        contactEmail: "leasing@example.com",
        publishedAt: new Date("2026-04-04T10:00:00"),
      },
      {
        publicId: "kits-draft-demo",
        status: "draft",
        title: "Kitsilano Two-Bedroom Draft",
        propertyType: "Apartment",
        neighborhood: "Kitsilano",
        city: "Vancouver",
        province: "BC",
        monthlyRent: 4200,
        bedrooms: 2,
        bathrooms: 2,
        areaSqft: 970,
        summary: "A draft example for your internal team to edit before publishing.",
        description:
          "Use this draft item to test updates, upload photos, and preview how unpublished listings stay hidden until you explicitly publish them.",
        highlights: "Draft only\nNot visible to renters yet",
        amenities: "Patio\nStorage locker",
        petPolicy: "Case by case",
        parkingInfo: "Available for an additional fee",
        furnishedInfo: "Partly furnished",
        contactName: "Leasing Team",
        contactEmail: "leasing@example.com",
      },
    ],
  });
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
