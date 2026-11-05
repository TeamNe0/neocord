import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Command, CommandDialog, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { isSamePage, prepareNavigation } from "@/lib/navigation.ts";

interface SearchEntry {
  url: string;
  page: string;
  group: string;
  heading: string;
  text: string;
}

let cachedIndex: Promise<SearchEntry[]> | null = null;

function loadIndex(): Promise<SearchEntry[]> {
  cachedIndex ??= fetch("/search-index.json").then(async (response) => {
    if (!response.ok) throw new Error(`Search index returned ${response.status}.`);
    return (await response.json()) as SearchEntry[];
  });
  cachedIndex.catch(() => {
    cachedIndex = null;
  });
  return cachedIndex;
}

function score(entry: SearchEntry, terms: readonly string[]): number {
  const page = entry.page.toLowerCase();
  const heading = entry.heading.toLowerCase();
  const text = entry.text.toLowerCase();
  let total = 0;
  for (const term of terms) {
    let best = 0;
    if (page === term) best = 30;
    else if (page.includes(term)) best = 14;
    if (heading.includes(term)) best = Math.max(best, 10);
    if (text.includes(term)) best = Math.max(best, 3);
    if (best === 0) return 0;
    total += best;
  }
  return entry.heading === "" ? total + 2 : total;
}

function excerpt(text: string, terms: readonly string[]): string {
  if (text.length <= 130) return text;
  const lower = text.toLowerCase();
  const first = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0);
  const position = first.length > 0 ? Math.min(...first) : 0;
  const start = Math.max(0, position - 40);
  return `${start > 0 ? "…" : ""}${text.slice(start, start + 130).trim()}…`;
}

export default function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [index, setIndex] = useState<SearchEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    let active = true;
    setFailed(false);
    loadIndex().then(
      (entries) => {
        if (active) setIndex(entries);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [open]);

  const terms = useMemo(
    () => query.toLowerCase().split(/\s+/).filter((term) => term !== ""),
    [query],
  );

  const results = useMemo(() => {
    if (index === null || terms.length === 0) return [];
    return index
      .map((entry) => ({ entry, value: score(entry, terms) }))
      .filter((result) => result.value > 0)
      .sort((left, right) => right.value - left.value)
      .slice(0, 20)
      .map((result) => result.entry);
  }, [index, terms]);

  const openEntry = (entry: SearchEntry): void => {
    onClose();
    const path = entry.url.split("#")[0] ?? entry.url;
    prepareNavigation(window.location.pathname, path);
    void navigate(entry.url, { viewTransition: !isSamePage(window.location.pathname, path) });
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Search the documentation"
      description="Type to search. Use the arrow keys to move and Enter to open a result."
      className="top-[12dvh] w-[min(40rem,calc(100vw-2rem))] max-w-none shadow-2xl sm:max-w-none"
    >
      <Command shouldFilter={false} className="bg-popover">
        <CommandInput
          aria-label="Search the documentation"
          placeholder="Search the docs"
          className="py-1 text-base"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList className="max-h-[56dvh] pt-1">
          {results.map((entry) => (
            <CommandItem
              key={entry.url}
              value={entry.url}
              onSelect={() => openEntry(entry)}
              className="block cursor-pointer rounded-lg px-3 py-2 transition-colors data-selected:bg-accent data-selected:shadow-[inset_3px_0_0_var(--slash)] [&>svg]:hidden"
            >
              <span className="block text-[0.95rem] font-bold">
                {entry.page}
                {entry.heading === "" ? "" : `: ${entry.heading}`}
              </span>
              <span className="block text-[0.84rem] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
                {excerpt(entry.text, terms)}
              </span>
            </CommandItem>
          ))}
        </CommandList>
        <p className="px-3 py-2 text-[0.82rem] text-muted-foreground" role="status">
          {failed
            ? "The search index could not be loaded. Check your connection and try again."
            : index === null
              ? "Loading the search index."
              : terms.length === 0
                ? "Type to search. Use the arrow keys to move and Enter to open a result."
                : results.length === 0
                  ? `No results for "${query}". Try a shorter or different term.`
                  : `${results.length} result${results.length === 1 ? "" : "s"}`}
        </p>
      </Command>
    </CommandDialog>
  );
}
