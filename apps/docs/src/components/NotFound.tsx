import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { SlashMark } from "./Logo.tsx";

export function NotFound() {
  return (
    <main id="main" tabIndex={-1} className="relative isolate mx-auto max-w-[56rem] overflow-hidden px-5 py-20 sm:py-28">
      <SlashMark className="hero-slash absolute top-6 right-0 -z-10 h-[85%] w-auto text-slash/15" />
      <h1 className="hero-line type-display max-w-[16ch] text-[clamp(2.2rem,6.5vw,3.6rem)]">This page does not exist</h1>
      <p className="mt-4 max-w-[34rem] text-lg text-muted-foreground">
        The address may be out of date. Go to the documentation, or press Ctrl K to search it.
      </p>
      <p className="mt-7 flex flex-wrap gap-2.5">
        <Button asChild className="sweep h-11 px-5 text-base font-bold">
          <Link to="/docs" viewTransition>
            Open the docs
          </Link>
        </Button>
        <Button asChild variant="outline" className="sweep h-11 px-5 text-base font-bold">
          <Link to="/" viewTransition>
            Go to the home page
          </Link>
        </Button>
      </p>
    </main>
  );
}
