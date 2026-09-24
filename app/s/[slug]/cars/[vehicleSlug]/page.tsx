import { slugVehicleRoute } from "@/lib/site-routes";

// See lib/site-routes.tsx: every public page is one of four routes in one of three languages.
const route = slugVehicleRoute("en");

export const generateMetadata = route.generateMetadata;
export default route.Page;
