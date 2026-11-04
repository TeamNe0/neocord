import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

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

export default function SearchDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();
  const [index, setIndex] = useState<SearchEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) element.showModal();
    return () => element?.close();
  }, []);

  useEffect(() => {
    let active = true;
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
  }, []);

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

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    dialog.current
      ?.querySelector(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const open = (entry: SearchEntry | undefined): void => {
    if (entry === undefined) return;
    onClose();
    void navigate(entry.url);
  };

  return (
    <dialog
      ref={dialog}
      className="search-dialog"
      aria-label="Search the documentation"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <div className="search-panel">
        <input
          autoFocus
          type="search"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="search-results"
          aria-autocomplete="list"
          aria-activedescendant={results.length > 0 ? `search-option-${selected}` : undefined}
          aria-label="Search the documentation"
          placeholder="Search the docs"
          className="search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelected((value) => Math.min(value + 1, Math.max(results.length - 1, 0)));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelected((value) => Math.max(value - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              open(results[selected]);
            }
          }}
        />
        <ul id="search-results" role="listbox" aria-label="Search results" className="search-results">
          {results.map((entry, position) => (
            <li
              key={entry.url}
              id={`search-option-${position}`}
              data-index={position}
              role="option"
              aria-selected={position === selected}
              className="search-result"
              onClick={() => open(entry)}
              onMouseEnter={() => setSelected(position)}
            >
              <span className="search-result-title">
                {entry.page}
                {entry.heading === "" ? "" : `: ${entry.heading}`}
              </span>
              <span className="search-result-text">{excerpt(entry.text, terms)}</span>
            </li>
          ))}
        </ul>
        <p className="search-status" role="status">
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
      </div>
    </dialog>
  );
}
