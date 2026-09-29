import { redirect } from "next/navigation";

/** Change requests moved under direct booking, as one of its tabs. */
export default function BookingRequestsRedirect() {
  redirect("/direct-booking/requests");
}
