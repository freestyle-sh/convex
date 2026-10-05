import { useEffect, useRef, useState, type HTMLAttributes } from "react";

const defaultWidth = 240;
const railWidth = 48;
const minWidth = 220;
const maxWidth = 400;
const collapseThreshold = (railWidth + minWidth) / 2;
const widthStorageKey = "workbench.sidebar-width";
const collapsedStorageKey = "workbench.sidebar-collapsed";
const clamp = (width: number) => Math.max(minWidth, Math.min(maxWidth, width));
type SidebarLayout = { width: number; collapsed: boolean };

function rememberLayout(layout: SidebarLayout) {
  try {
    localStorage.setItem(widthStorageKey, String(layout.width));
    localStorage.setItem(collapsedStorageKey, String(layout.collapsed));
  } catch {
    /* Optional layout preference. */
  }
}

export function useSidebarResize() {
  const [layout, setLayout] = useState<SidebarLayout>({
    width: defaultWidth,
    collapsed: false,
  });
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    expandedWidth: number;
    layout: SidebarLayout;
  } | null>(null);
  const width = layout.collapsed ? railWidth : layout.width;

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(widthStorageKey));
      setLayout({
        width:
          Number.isFinite(saved) && saved > 0 ? clamp(saved) : defaultWidth,
        collapsed: localStorage.getItem(collapsedStorageKey) === "true",
      });
    } catch {
      /* Optional layout preference. */
    }
  }, []);

  const updateLayout = (next: SidebarLayout) => {
    setLayout(next);
    rememberLayout(next);
  };
  const toggle = () =>
    updateLayout({ ...layout, collapsed: !layout.collapsed });

  const handleProps: HTMLAttributes<HTMLDivElement> = {
    role: "separator",
    tabIndex: 0,
    "aria-label": "Resize sidebar",
    "aria-orientation": "vertical",
    "aria-controls": "workspace-sidebar",
    "aria-valuemin": railWidth,
    "aria-valuemax": maxWidth,
    "aria-valuenow": width,
    "aria-valuetext": layout.collapsed ? "Collapsed" : `${width} pixels`,
    title: "Drag to resize or collapse · Double-click to reset",
    onPointerDown(event) {
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: width,
        expandedWidth: layout.width,
        layout,
      };
      setResizing(true);
    },
    onPointerMove(event) {
      if (!drag.current || drag.current.pointerId !== event.pointerId) return;
      const requested = Math.round(
        drag.current.startWidth + event.clientX - drag.current.startX,
      );
      const collapsed = requested < collapseThreshold;
      const next = {
        width: collapsed ? drag.current.expandedWidth : clamp(requested),
        collapsed,
      };
      drag.current.layout = next;
      setLayout(next);
    },
    onLostPointerCapture() {
      if (drag.current) rememberLayout(drag.current.layout);
      drag.current = null;
      setResizing(false);
    },
    onDoubleClick() {
      updateLayout({ width: defaultWidth, collapsed: false });
    },
    onKeyDown(event) {
      let next: SidebarLayout;
      switch (event.key) {
        case "ArrowLeft":
          next =
            layout.collapsed || width <= minWidth
              ? { ...layout, collapsed: true }
              : { width: clamp(width - 10), collapsed: false };
          break;
        case "ArrowRight":
          next = {
            width: layout.collapsed ? layout.width : clamp(width + 10),
            collapsed: false,
          };
          break;
        case "Home":
          next = { ...layout, collapsed: true };
          break;
        case "End":
          next = { width: maxWidth, collapsed: false };
          break;
        case "Enter":
          next = { ...layout, collapsed: !layout.collapsed };
          break;
        default:
          return;
      }
      event.preventDefault();
      updateLayout(next);
    },
  };

  return { width, collapsed: layout.collapsed, toggle, resizing, handleProps };
}
