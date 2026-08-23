import { register } from "./store";
/* store first — strategy modules self-register into it on import */
import "./strategies/s100-momentum";
import "./strategies/s104-pead";
import "./strategies/s105-analyst-revision";
import "./strategies/s172-dual";
import "./strategies/s174-tsm";
import "./strategies/s081-fscore";
import { roc20Strategy } from "./demo/roc20";
import { w52LowStrategy } from "./demo/52wlow";
import { qualityStrategy } from "./strategies/quality";
import { valueStrategies } from "./strategies/s099-value";

export { register, getStrategy, listStrategies } from "./store";
export type { Strategy } from "./types";

register(roc20Strategy);
register(w52LowStrategy);
register(qualityStrategy);
for (const s of valueStrategies) register(s);
