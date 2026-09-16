import type { PinoLog } from "@web/api";
import { JsonValue } from "@web/components/json-value";
import { levelLabel } from "@web/lib/format";

export function LogDetails({ log }: { log: PinoLog }) {
  const attributes = Object.keys(log.attributes ?? {}).length > 0 ? log.attributes : null;

  return (
    <div className="log-details">
      <dl className="detail-grid">
        <div>
          <dt>ID</dt>
          <dd className="mono">{log.id}</dd>
        </div>
        <div>
          <dt>レベル</dt>
          <dd>{levelLabel(log.level)}</dd>
        </div>
      </dl>
      {attributes ? (
        <JsonValue className="json-block" value={attributes} />
      ) : (
        <p className="muted">属性はありません</p>
      )}
    </div>
  );
}
