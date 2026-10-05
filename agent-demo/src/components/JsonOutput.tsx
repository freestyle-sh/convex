import { SyntaxCode } from "./SyntaxCode";

export function JsonOutput({ text }: { text: string }) {
  // Match a JSON object/array prefix so truncated output is still highlighted.
  // Preserve the original bytes, indentation and line breaks rather than reparsing.
  const json =
    /^\s*(?:\{\s*(?:"|\})|\[\s*(?:\{|\[|"|-?\d|true\b|false\b|null\b|\]))/.test(
      text,
    );
  return json ? <SyntaxCode code={text} language="json" /> : <>{text}</>;
}
