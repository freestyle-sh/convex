import { createContext } from "react";

// Portal menus opened inside a native dialog must stay in its top layer.
export const OverlayContainer = createContext<HTMLElement | null>(null);
