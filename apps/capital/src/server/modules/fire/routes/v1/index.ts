import { createRouter } from "@capital/server/lib/create-app";

import * as getFireSummary from "./get-fire-summary";
import * as putFireGoal from "./put-fire-goal";
import * as postFireSnapshot from "./post-fire-snapshot";
import * as getFireSnapshots from "./get-fire-snapshots";
import * as putFireSnapshotPeriod from "./put-fire-snapshot-period";
import * as deleteFireSnapshot from "./delete-fire-snapshot";

const router = createRouter()
  .openapi(getFireSummary.route, getFireSummary.handler)
  .openapi(putFireGoal.route, putFireGoal.handler)
  .openapi(postFireSnapshot.route, postFireSnapshot.handler)
  .openapi(getFireSnapshots.route, getFireSnapshots.handler)
  .openapi(putFireSnapshotPeriod.route, putFireSnapshotPeriod.handler)
  .openapi(deleteFireSnapshot.route, deleteFireSnapshot.handler);

export default router;
