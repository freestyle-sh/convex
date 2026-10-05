import { useRef, useState, type ReactNode, type MouseEvent } from "react";
import { Link } from "@tanstack/react-router";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import { Check, ExternalLink, Link2, Pencil, Trash2 } from "lucide-react";
import type { Conversation } from "../types";
import { useNavigationIntent } from "../useNavigationIntent";

const itemLayout =
  "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] outline-none select-none";
const itemClass = `${itemLayout} text-zinc-700 data-[highlighted]:bg-zinc-100 data-[highlighted]:text-zinc-950`;

export function ConversationLink({
  conversation,
  onRename,
  onDelete,
  onNavigate,
  children,
  className,
  "aria-current": ariaCurrent,
}: {
  conversation: Conversation;
  onRename: (title: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onNavigate: () => void;
  children: ReactNode;
  className: string;
  "aria-current"?: "page";
}) {
  const intent = useNavigationIntent(
    ariaCurrent
      ? undefined
      : {
          kind: "chat",
          projectId: conversation.projectId,
          threadId: conversation.threadId,
        },
  );
  const link = useRef<HTMLAnchorElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const openingEditor = useRef<"rename" | "delete" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editor, setEditor] = useState<"rename" | "delete" | null>(null);
  const [point, setPoint] = useState({ x: 0, y: 0 });
  const [title, setTitle] = useState(conversation.title);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const href = `/chats/${encodeURIComponent(conversation.threadId)}`;
  const anchorStyle = {
    position: "fixed" as const,
    left: point.x,
    top: point.y,
    width: 0,
    height: 0,
    pointerEvents: "none" as const,
  };
  const open = (event?: MouseEvent<HTMLAnchorElement>) => {
    event?.preventDefault();
    const rect = link.current!.getBoundingClientRect();
    setPoint(
      event && (event.clientX || event.clientY)
        ? { x: event.clientX, y: event.clientY }
        : { x: rect.left + 16, y: rect.bottom },
    );
    setError("");
    setCopied(false);
    setMenuOpen(true);
  };

  return (
    <>
      <Link
        {...intent}
        ref={link}
        to="/chats/$chatId"
        params={{ chatId: conversation.threadId }}
        className={className}
        aria-current={ariaCurrent}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(event) => (event.altKey ? open(event) : onNavigate())}
        onContextMenu={open}
        onKeyDown={(event) => {
          if (
            event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10")
          ) {
            event.preventDefault();
            open();
          }
        }}
      >
        {children}
      </Link>
      <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenu.Trigger asChild>
          <span aria-hidden="true" tabIndex={-1} style={anchorStyle} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            aria-label="Chat options"
            align="start"
            sideOffset={4}
            collisionPadding={8}
            loop
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (openingEditor.current) {
                setEditor(openingEditor.current);
                openingEditor.current = null;
              } else {
                link.current?.focus();
              }
            }}
            className="z-50 w-48 rounded-lg border border-zinc-200 bg-surface p-1 shadow-lg shadow-zinc-950/10 outline-none"
          >
            <DropdownMenu.Item
              className={itemClass}
              onSelect={() => {
                setTitle(conversation.title);
                setError("");
                openingEditor.current = "rename";
              }}
            >
              <Pencil size={14} /> Rename
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={itemClass}
              onSelect={(event) => {
                event.preventDefault();
                void navigator.clipboard
                  .writeText(new URL(href, window.location.origin).href)
                  .then(
                    () => {
                      setCopied(true);
                      setError("");
                    },
                    () => setError("Couldn’t copy the link. Try again."),
                  );
              }}
            >
              {copied ? <Check size={14} /> : <Link2 size={14} />}
              {copied ? "Link copied" : "Copy link"}
            </DropdownMenu.Item>
            <DropdownMenu.Item asChild className={itemClass}>
              <a href={href} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={14} /> Open in new tab
              </a>
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="mx-1 my-1 h-px bg-zinc-100" />
            <DropdownMenu.Item
              className={`${itemLayout} text-red-600 data-[highlighted]:bg-red-50 data-[highlighted]:text-red-700`}
              onSelect={() => {
                setError("");
                openingEditor.current = "delete";
              }}
            >
              <Trash2 size={14} /> Delete
            </DropdownMenu.Item>
            {error && (
              <p role="alert" className="px-2.5 py-2 text-xs text-red-600">
                {error}
              </p>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <Popover.Root
        open={editor !== null}
        onOpenChange={(value) => {
          if (!saving && !value) setEditor(null);
        }}
        modal
      >
        <Popover.Anchor asChild>
          <span style={anchorStyle} />
        </Popover.Anchor>
        <Popover.Portal>
          <Popover.Content
            aria-label={editor === "delete" ? "Delete chat" : "Rename chat"}
            align="start"
            sideOffset={4}
            collisionPadding={8}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              if (editor === "delete") cancel.current?.focus();
              else {
                input.current?.focus();
                input.current?.select();
              }
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              (
                link.current ??
                document.querySelector<HTMLButtonElement>(".new-chat")
              )?.focus();
            }}
            className="z-50 w-72 max-w-[calc(100vw-1rem)] rounded-xl border border-zinc-200 bg-surface p-3 shadow-lg shadow-zinc-950/10 outline-none"
          >
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (saving || (editor === "rename" && !title.trim())) return;
                setSaving(true);
                setError("");
                try {
                  if (editor === "delete") {
                    await onDelete();
                  } else await onRename(title.trim());
                  setEditor(null);
                } catch {
                  setError(
                    editor === "delete"
                      ? "Couldn’t delete this chat. Try again."
                      : "Couldn’t rename this chat. Try again.",
                  );
                } finally {
                  setSaving(false);
                }
              }}
            >
              {editor === "delete" ? (
                <>
                  <h2 className="text-sm font-semibold text-zinc-950">
                    Delete chat?
                  </h2>
                  <p
                    className="mt-1 truncate text-xs text-zinc-700"
                    title={conversation.title}
                  >
                    {conversation.title}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-zinc-500">
                    This chat and its messages will be permanently deleted.
                    {conversation.state === "running" ||
                    conversation.state === "queued"
                      ? " Any ongoing work will be canceled."
                      : ""}
                  </p>
                </>
              ) : (
                <label className="block text-xs font-medium text-zinc-600">
                  Chat name
                  <input
                    ref={input}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    maxLength={120}
                    required
                    disabled={saving}
                    className="mt-2 w-full rounded-md border border-zinc-300 bg-transparent px-2.5 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
                  />
                </label>
              )}
              {error && (
                <p role="alert" className="mt-2 text-xs text-red-600">
                  {error}
                </p>
              )}
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  ref={cancel}
                  disabled={saving}
                  onClick={() => setEditor(null)}
                  className="rounded-md px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || (editor === "rename" && !title.trim())}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 ${editor === "delete" ? "bg-red-600 hover:bg-red-700" : "bg-zinc-900 hover:bg-zinc-700"}`}
                >
                  {editor === "delete"
                    ? saving
                      ? "Deleting…"
                      : "Delete"
                    : saving
                      ? "Saving…"
                      : "Save"}
                </button>
              </div>
            </form>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}
