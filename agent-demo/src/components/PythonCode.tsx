import { SyntaxCode } from "./SyntaxCode";

export function PythonCode({
  code,
  className = "",
}: {
  code: string;
  className?: string;
}) {
  return <SyntaxCode code={code} language="python" className={className} />;
}
