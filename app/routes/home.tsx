import type { Route } from "../+types/root";
import { Welcome } from "../welcome/welcome";

export function meta({ }: Route.MetaArgs) {
  return [
    { title: "Shear Madness" },
    { name: "description", content: "Welcome to Shear Madness!" },
  ];
}

export default function Home() {
  return <Welcome />;
}
