import { ArrowUpRight } from "lucide-react";
import { Link } from "@tanstack/react-router";

export function NotFound({
  resource = "page",
}: {
  resource?: "page" | "chat" | "artifact";
}) {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-6 py-12 text-ink">
      <div className="grid w-full max-w-4xl items-center gap-10 sm:grid-cols-[1.1fr_1fr] sm:gap-16">
        <div
          aria-hidden="true"
          className="relative mx-auto grid aspect-square w-full max-w-80 place-items-center overflow-hidden rounded-[2rem] bg-field/60 sm:max-w-none"
        >
          <svg
            viewBox="0 0 400 400"
            className="absolute inset-0 size-full text-line-strong"
            fill="none"
          >
            <path
              d="M0 80H400M0 160H400M0 240H400M0 320H400M80 0V400M160 0V400M240 0V400M320 0V400"
              stroke="currentColor"
              strokeOpacity=".45"
              strokeDasharray="2 6"
            />
            <path
              d="M-20 310L64 275L118 300L170 228M231 188L289 128L330 148L420 71"
              stroke="var(--color-accent-plum)"
              strokeWidth="2"
              strokeOpacity=".45"
              strokeLinecap="round"
            />
            <circle
              cx="170"
              cy="228"
              r="5"
              fill="var(--color-canvas)"
              stroke="var(--color-accent-plum)"
            />
            <circle
              cx="231"
              cy="188"
              r="5"
              fill="var(--color-canvas)"
              stroke="var(--color-accent-plum)"
            />
          </svg>
          <span className="relative text-[clamp(7rem,17vw,10rem)] leading-none font-semibold tracking-[-0.09em] text-ink">
            4<span className="text-accent-plum">0</span>4
          </span>
        </div>
        <div className="mx-auto max-w-sm text-center sm:mx-0 sm:text-left">
          <p className="mb-3 text-xs font-medium tracking-wide text-ink-3">
            {resource === "page"
              ? "Page not found"
              : `${resource === "chat" ? "Chat" : "Artifact"} not found`}
          </p>
          <h1 className="text-4xl leading-[1.12] font-semibold tracking-[-0.04em] sm:text-[2.75rem]">
            Nothing at this address<span className="text-accent-plum">.</span>
          </h1>
          <p className="mt-4 text-sm leading-6 text-ink-3">
            {resource === "page"
              ? "This link may be out of date. Your chats and artifacts are back in your workspace."
              : `This ${resource} may have been removed, or isn’t available in your workspace.`}
          </p>
          <Link
            to="/chats"
            className="mt-7 inline-flex h-11 items-center justify-center gap-4 rounded-xl bg-ink px-5 text-sm font-medium text-white transition-colors hover:bg-accent-plum"
          >
            Back to workspace
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </main>
  );
}
