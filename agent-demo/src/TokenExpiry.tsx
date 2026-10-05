import { Clock3 } from "lucide-react";

export function TokenExpiry({
  expiresAt,
  checkedAt,
}: {
  expiresAt?: number | null;
  checkedAt?: number;
}) {
  const remaining =
    typeof expiresAt === "number" ? expiresAt - Date.now() : undefined;
  const expired = remaining !== undefined && remaining <= 0;
  const soon =
    remaining !== undefined && remaining > 0 && remaining <= 7 * 86_400_000;
  const date =
    typeof expiresAt === "number"
      ? new Date(expiresAt).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "";
  return (
    <div
      className={`flex items-start gap-2 text-xs leading-5 ${expired ? "text-red-700" : soon ? "text-amber-700" : "text-zinc-500"}`}
    >
      <Clock3 size={14} className="mt-0.5" />
      <div>
        <p className="font-medium text-zinc-700">Connection token</p>
        <p>
          {expiresAt === null
            ? "No expiration set in Convex"
            : expiresAt === undefined
              ? "Expiry unavailable — check Convex Team Settings → Access Tokens."
              : `${expired ? "Expired" : "Expires"} ${date}${soon ? " · Replace soon" : ""}`}
        </p>
        {checkedAt && (
          <p className="mt-0.5 text-zinc-400">
            Last checked {new Date(checkedAt).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}
