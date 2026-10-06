import { slugLegalRoute } from "@/lib/site-routes";

// See lib/site-routes.tsx: the site's privacy policy and booking terms.
const route = slugLegalRoute("en");

export const generateMetadata = route.generateMetadata;
export default route.Page;
