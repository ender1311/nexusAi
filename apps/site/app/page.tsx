import { activeBrand } from "@site/brand/presets";
import { LandingPage } from "@site/components/landing-page";

export default function Page() {
  return <LandingPage brand={activeBrand()} />;
}
