export async function register() {
    if (process.env.NEXT_RUNTIME !== "nodejs") {
        return;
    }

    const { startFestivalScheduler } = await import("@/lib/services/festival-scheduler");
    startFestivalScheduler();
}
