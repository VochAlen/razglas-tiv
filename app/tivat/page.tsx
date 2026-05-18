import type { Metadata } from "next";
import AirportPA from "@/components/AirportPA";

export const metadata: Metadata = {
  title: "Tivat Airport PA System",
  description: "Passenger Announcement System — Podgorica Airport (TGD/LYPG)",
};

export default function Page() {
  return <AirportPA />;
}