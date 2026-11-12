import { useEffect, useState } from "react";

// The compact layout: below this width the sidebar folds to a rail and panes stack in one column.
export const NARROW_QUERY = "(max-width: 620px)";

export function useNarrow(query = NARROW_QUERY): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return narrow;
}

export function useCompactSidebar() { return useNarrow("(max-width: 1100px)"); }
