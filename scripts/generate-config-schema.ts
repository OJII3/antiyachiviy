import { writeFile } from "node:fs/promises";

import { YachigravityConfigSchema } from "@app/config-schema";

await writeFile(
  "config/yachigravity.schema.json",
  `${JSON.stringify(YachigravityConfigSchema, null, 2)}\n`,
);
