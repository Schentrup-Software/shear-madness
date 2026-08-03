import type { Route } from "../+types/root";
import { Welcome } from "../welcome/welcome";

export function meta({ }: Route.MetaArgs) {
  return [
    { title: "Shear Madness — Cornhole Tournament Manager" },
    {
      name: "description",
      content:
        "Run Cornhole tournaments with QR code player sign-ups and a live single-elimination bracket. Optionally notify players in Google Chat when their match starts.",
    },
  ];
}

export default function Home() {
  return <Welcome />;
}
