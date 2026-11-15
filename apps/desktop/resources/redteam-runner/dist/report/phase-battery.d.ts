import { type Ctx } from '../context.js';
export declare function computeBatteryStatus(ctx: Ctx): {
    fbStatus: {
        t: import("../targets.js").TargetId;
        c: import("../battery.js").BatteryCategory;
        s: import("../targets.js").CellStatus;
    }[];
    fbPlanOnly: string[];
    lsum: import("../coverage/items.js").LedgerSummary;
    pendingKeys: string[];
    nonCleanItems: import("../coverage/items.js").ItemVerdict[];
    batteryLine: string;
};
