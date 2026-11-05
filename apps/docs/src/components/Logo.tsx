import { cn } from "@/lib/utils";

export function SlashMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 32" aria-hidden="true" className={cn("fill-current", className)}>
      <path d="M16 0h8L8 32H0z" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2 font-display text-[1.12rem] font-extrabold tracking-tight [font-stretch:115%]">
      <SlashMark className="h-5 w-[15px] text-slash transition-transform duration-300 ease-out group-hover/logo:-translate-y-0.5 group-hover/logo:translate-x-px in-data-[surface=hero]:text-sun" />
      <span>neocord</span>
    </span>
  );
}
