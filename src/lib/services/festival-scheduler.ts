type SchedulerGlobal = typeof globalThis & {
    __festivalSchedulerStarted?: boolean;
    __festivalSchedulerRunning?: boolean;
    __festivalSchedulerTimer?: NodeJS.Timeout;
};

const globalForScheduler = globalThis as SchedulerGlobal;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const SCHEDULE_HOURS_KST = [9, 18];

const toKstDate = (date: Date) => new Date(date.getTime() + KST_OFFSET_MS);

const createUtcDateFromKst = (
    year: number,
    monthIndex: number,
    day: number,
    hour: number,
    minute = 0,
) => new Date(Date.UTC(year, monthIndex, day, hour, minute) - KST_OFFSET_MS);

const getNextScheduledRun = (now = new Date()) => {
    const kstNow = toKstDate(now);
    const year = kstNow.getUTCFullYear();
    const monthIndex = kstNow.getUTCMonth();
    const day = kstNow.getUTCDate();

    for (const hour of SCHEDULE_HOURS_KST) {
        const candidate = createUtcDateFromKst(year, monthIndex, day, hour, 0);
        if (candidate.getTime() > now.getTime()) {
            return candidate;
        }
    }

    return createUtcDateFromKst(year, monthIndex, day + 1, SCHEDULE_HOURS_KST[0], 0);
};

const shouldEnableScheduler = () => {
    if (process.env.FESTIVAL_ENABLE_SCHEDULER === "true") return true;
    if (process.env.FESTIVAL_ENABLE_SCHEDULER === "false") return false;
    return process.env.NODE_ENV === "production";
};

type FestivalServiceModule = {
    festivalService: {
        syncTodayFestivals: () => Promise<unknown>;
    };
};

const importFestivalService = async (): Promise<FestivalServiceModule> => {
    const importer = new Function("specifier", "return import(specifier);") as (
        specifier: string,
    ) => Promise<FestivalServiceModule>;

    return importer("./festival-service");
};

export function startFestivalScheduler() {
    if (globalForScheduler.__festivalSchedulerStarted) return;
    if (!shouldEnableScheduler()) return;
    globalForScheduler.__festivalSchedulerStarted = true;

    const run = async () => {
        if (globalForScheduler.__festivalSchedulerRunning) return;
        globalForScheduler.__festivalSchedulerRunning = true;
        try {
            const { festivalService } = await importFestivalService();
            await festivalService.syncTodayFestivals();
        } catch (error) {
            console.error("Festival scheduler run failed:", error);
        } finally {
            globalForScheduler.__festivalSchedulerRunning = false;
        }
    };

    const scheduleNext = () => {
        const nextRunAt = getNextScheduledRun();
        const delayMs = Math.max(1_000, nextRunAt.getTime() - Date.now());

        globalForScheduler.__festivalSchedulerTimer = setTimeout(async () => {
            try {
                await run();
            } finally {
                scheduleNext();
            }
        }, delayMs);
    };

    scheduleNext();
}
