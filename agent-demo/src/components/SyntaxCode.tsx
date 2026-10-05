import { useMemo, type ReactNode } from "react";
import { refractor } from "refractor/core";
import python from "refractor/python";
import json from "refractor/json";

refractor.register(python);
refractor.register(json);

type SyntaxNode = ReturnType<typeof refractor.highlight>["children"][number];

function renderTokens(nodes: SyntaxNode[]): ReactNode {
  return nodes.map((node, index) => {
    if (node.type === "text") return node.value;
    if (node.type !== "element") return null;
    return (
      <span
        key={index}
        className={(node.properties.className as string[] | undefined)?.join(
          " ",
        )}
      >
        {renderTokens(node.children)}
      </span>
    );
  });
}

export function SyntaxCode({
  code,
  language,
  className = "",
}: {
  code: string;
  language: "python" | "json";
  className?: string;
}) {
  const tokens = useMemo(
    () => refractor.highlight(code, language).children,
    [code, language],
  );
  return (
    <code
      className={`syntax-code ${language}-code language-${language} ${className}`}
    >
      {renderTokens(tokens)}
    </code>
  );
}
