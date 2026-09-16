import { collapseAllNested, darkStyles, JsonView } from "react-json-view-lite";
import "react-json-view-lite/dist/index.css";

import { isJsonContainer, stringify } from "@web/lib/format";

interface JsonValueProps {
  value: unknown;
  className?: string;
}

export function JsonValue({ value, className = "" }: JsonValueProps) {
  const classes = `json-value ${className}`.trim();

  if (!isJsonContainer(value)) {
    return <pre className={classes}>{stringify(value)}</pre>;
  }

  return (
    <div className={classes}>
      <JsonView
        aria-label="JSON データ"
        compactTopLevel
        data={value}
        shouldExpandNode={collapseAllNested}
        style={darkStyles}
      />
    </div>
  );
}
