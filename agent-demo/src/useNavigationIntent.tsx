import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useConvex } from "convex/react";
import {
  NavigationPreloader,
  type NavigationTarget,
} from "./navigationPreload";

const PreloadContext = createContext<NavigationPreloader | null>(null);

export function NavigationPreloadProvider({
  token,
  children,
}: {
  token: string;
  children: ReactNode;
}) {
  const client = useConvex();
  const preloader = useMemo(
    () => new NavigationPreloader(client, token),
    [client, token],
  );
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") preloader.clear();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      preloader.clear();
    };
  }, [preloader]);
  return (
    <PreloadContext.Provider value={preloader}>
      {children}
    </PreloadContext.Provider>
  );
}

export function useNavigationIntent(target?: NavigationTarget) {
  const preloader = useContext(PreloadContext);
  const key = JSON.stringify(target);
  useEffect(
    () => () => {
      if (key) preloader?.cancel(JSON.parse(key));
    },
    [preloader, key],
  );
  return useMemo(() => {
    const destination: NavigationTarget | undefined = key
      ? JSON.parse(key)
      : undefined;
    const warm = (immediate = false) => {
      const connection = (
        navigator as Navigator & { connection?: { saveData?: boolean } }
      ).connection;
      if (
        !destination ||
        !preloader ||
        navigator.onLine === false ||
        connection?.saveData ||
        document.visibilityState === "hidden"
      )
        return;
      if (immediate) preloader.preload(destination);
      else preloader.schedule(destination);
    };
    const cancel = () => {
      if (destination) preloader?.cancel(destination);
    };
    return {
      onPointerEnter: (event: PointerEvent<HTMLElement>) => {
        if (event.pointerType !== "touch") warm();
      },
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      onFocus: () => warm(),
      onBlur: cancel,
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (event.button === 0) warm(true);
      },
    };
  }, [preloader, key]);
}
