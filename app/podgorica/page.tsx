import type { Metadata } from "next";
import AirportPA_TGD from "@/components/AirportPA-TGD";

export const metadata: Metadata = {
  title: "Podgorica Airport PA System",
  description: "Passenger Announcement System — Podgorica Airport (TGD/LYPG)",
};

export default function Page() {
  return <AirportPA_TGD />;
}