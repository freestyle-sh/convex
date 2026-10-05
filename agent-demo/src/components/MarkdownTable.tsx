import type { Element, ElementContent } from "hast";
import { ResultTable } from "./ResultTable";
import type { SelectResult } from "../results";

function text(node: ElementContent): string {
  return node.type === "text"
    ? node.value
    : "children" in node
      ? node.children.map(text).join("")
      : "";
}
export function MarkdownTable({
  node,
  sourceId,
  onSelect,
}: {
  node?: Element;
  sourceId: string;
  onSelect?: SelectResult;
}) {
  const rows: string[][] = [];
  const visit = (element: Element) => {
    if (element.tagName === "tr")
      rows.push(
        element.children
          .filter((child): child is Element => child.type === "element")
          .map(text),
      );
    else
      element.children.forEach((child) => {
        if (child.type === "element") visit(child);
      });
  };
  if (node) visit(node);
  const [columns, ...body] = rows;
  if (!columns?.length) return null;
  return (
    <div className="my-4">
      <ResultTable
        table={{ title: "Results", columns, rows: body }}
        sourceId={`${sourceId}:table:${node?.position?.start.offset ?? 0}`}
        onSelect={onSelect}
      />
    </div>
  );
}
