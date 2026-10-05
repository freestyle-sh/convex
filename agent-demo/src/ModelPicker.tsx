import { OverlayContainer } from "./overlayContainer";
import { useContext, useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, LoaderCircle, Search } from "lucide-react";
import { api } from "../convex/_generated/api";
import {
  routedModelPresets,
  sortCatalog,
  type ModelChoice,
} from "../convex/lib/models";
import { connectionError } from "./errors";

export const providerName = (provider: ModelChoice["provider"]) =>
  provider === "convex" ? "Convex Gateway" : "OpenRouter";
type CatalogState = {
  models: typeof routedModelPresets;
  loaded: boolean;
  loading: boolean;
  error: string;
};
const initialCatalog: CatalogState = {
  models: routedModelPresets,
  loaded: false,
  loading: false,
  error: "",
};
export function modelLabel(model: ModelChoice) {
  return (
    routedModelPresets.find((m) => m.id === model.id)?.name ??
    model.id.split("/").slice(-1)[0]
  );
}
export function ModelPicker({
  token,
  value,
  onChange,
  disabled = false,
  fullWidth = false,
  allowProviderSwitch = true,
}: {
  token: string;
  value: ModelChoice;
  onChange: (choice: ModelChoice) => void;
  disabled?: boolean;
  fullWidth?: boolean;
  allowProviderSwitch?: boolean;
}) {
  const overlayContainer = useContext(OverlayContainer);
  const catalog = useAction(api.models.catalog);
  const [open, setOpen] = useState(false);
  const [browsedProvider, setProvider] = useState(value.provider);
  const provider = allowProviderSwitch ? browsedProvider : value.provider;
  const [search, setSearch] = useState("");
  const [catalogs, setCatalogs] = useState({
    convex: initialCatalog,
    openrouter: initialCatalog,
  });
  const { models, loaded, loading, error } = catalogs[provider];
  const [active, setActive] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const rows = useRef<Array<HTMLButtonElement | null>>([]);
  async function load() {
    const selected = provider;
    const update = (patch: Partial<CatalogState>) =>
      setCatalogs((all) => ({
        ...all,
        [selected]: { ...all[selected], ...patch },
      }));
    update({ loading: true, error: "" });
    try {
      const available = await catalog({ token, provider: selected });
      update({
        models: sortCatalog(available),
        loaded: true,
      });
    } catch (e) {
      update({ error: connectionError(e) });
    } finally {
      update({ loading: false });
    }
  }
  useEffect(() => {
    if (open && !loaded && !loading && !error) void load();
  }, [open, provider, loaded, loading, error]);
  const filtered = models
    .filter((m) =>
      `${m.name} ${m.id}`.toLowerCase().includes(search.toLowerCase()),
    )
    .slice(0, 80);
  const custom =
    search.trim().length <= 160 &&
    /^~?[\w.-]+\/[\w.:/-]+$/.test(search.trim()) &&
    !filtered.some((m) => m.id === search.trim());
  const choices = [
    ...filtered,
    ...(custom ? [{ id: search.trim(), name: "Use custom model ID" }] : []),
  ];
  function select(id: string) {
    onChange({ provider, id });
    setOpen(false);
  }
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setProvider(value.provider);
          setSearch("");
          setActive(0);
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`Choose model: ${modelLabel(value)} via ${providerName(value.provider)}`}
          className={`min-w-0 rounded-lg px-2.5 py-2 text-xs font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink ${fullWidth ? "w-full justify-between border border-line-strong bg-surface text-sm" : "max-w-[min(280px,65vw)]"}`}
        >
          <span className="truncate">{modelLabel(value)}</span>
          {allowProviderSwitch && (
            <span className="hidden text-[10px] font-normal text-ink-3 sm:inline">
              {providerName(value.provider)}
            </span>
          )}
          <ChevronDown size={12} />
        </button>
      </Popover.Trigger>
      <Popover.Portal container={overlayContainer ?? undefined}>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={10}
          collisionPadding={16}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            searchRef.current?.focus();
          }}
          onEscapeKeyDown={(event) => event.stopPropagation()}
          className="z-[80] w-[340px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-xl outline-none"
          aria-label="Choose a model"
        >
          {allowProviderSwitch && (
            <div
              className="flex gap-1 rounded-xl bg-field p-1"
              aria-label="Model provider"
            >
              {(["convex", "openrouter"] as const).map((p) => (
                <button
                  type="button"
                  key={p}
                  aria-pressed={p === provider}
                  onClick={() => {
                    setProvider(p);
                    setSearch("");
                    setActive(0);
                  }}
                  className={`flex-1 rounded-lg px-2 py-2 text-xs font-medium ${p === provider ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`}
                >
                  {providerName(p)}
                </button>
              ))}
            </div>
          )}
          <div className="relative my-1.5">
            <Search
              size={14}
              className="pointer-events-none absolute top-3 left-3 text-ink-3"
            />
            <input
              ref={searchRef}
              aria-label="Search models"
              role="combobox"
              aria-autocomplete="list"
              aria-controls="model-options"
              aria-expanded="true"
              aria-activedescendant={
                choices[active] ? `model-option-${active}` : undefined
              }
              value={search}
              placeholder="Search models or paste a model ID…"
              className="rounded-lg border-0 bg-transparent py-2.5 pr-3 pl-9 text-xs outline-none focus:outline-none"
              onChange={(e) => {
                setSearch(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (
                  (e.key === "ArrowDown" || e.key === "ArrowUp") &&
                  choices.length
                ) {
                  e.preventDefault();
                  const next =
                    (active +
                      (e.key === "ArrowDown" ? 1 : choices.length - 1)) %
                    choices.length;
                  setActive(next);
                  rows.current[next]?.scrollIntoView({ block: "nearest" });
                }
                if (e.key === "Enter" && choices[active]) {
                  e.preventDefault();
                  select(choices[active].id);
                }
              }}
            />
          </div>
          <div
            id="model-options"
            role="listbox"
            aria-label={`${providerName(provider)} models`}
            className="max-h-64 [scrollbar-width:thin] overflow-y-auto overscroll-contain"
          >
            {choices.map((m, i) => (
              <button
                type="button"
                role="option"
                id={`model-option-${i}`}
                aria-selected={value.provider === provider && value.id === m.id}
                tabIndex={-1}
                ref={(el) => {
                  rows.current[i] = el;
                }}
                key={m.id}
                onMouseEnter={() => setActive(i)}
                onClick={() => select(m.id)}
                className={`w-full justify-between rounded-lg px-3 py-2.5 text-left ${active === i ? "bg-hover" : "hover:bg-hover"}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-ink">
                    {m.name.replace(/^[^:]+: /, "")}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-ink-3">
                    {m.id}
                  </span>
                </span>
                {value.provider === provider && value.id === m.id && (
                  <Check size={14} className="text-ink-2" />
                )}
              </button>
            ))}
            {!choices.length && (
              <p className="px-3 py-4 text-xs text-ink-3">
                No matching models. Paste an exact model ID.
              </p>
            )}
          </div>
          <div className="mt-1.5 border-t border-line px-3 py-2 text-[10px] leading-4 text-ink-3">
            {loading ? (
              <span className="flex items-center gap-2">
                <LoaderCircle size={12} className="animate-spin" />
                Loading {providerName(provider)} models…
              </span>
            ) : error ? (
              <span>
                {error}{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => void load()}
                >
                  Retry
                </button>
              </span>
            ) : provider === "convex" ? (
              "Low-cost picks first · no API key needed. Other tool-capable model IDs supported."
            ) : (
              "Low-cost picks first · then newest releases. Text models with tool support."
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
