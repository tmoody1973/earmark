import { pollDelay } from "@/agent/lib/garden/live";

// GardenLive's single poller, kept free of React and the DOM so its scheduling is unit-tested (fake timers):
// one request at a time, one timer at a time, nothing while the tab is hidden, backoff after failures.

export interface PollerDeps {
  poll: (signal: AbortSignal) => Promise<void>;
  isVisible: () => boolean;
  onError: (err: unknown) => void;
}

export function startPoller({ poll, isVisible, onError }: PollerDeps): { visibilityChanged: () => void; stop: () => void } {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let inFlight = false;

  const schedule = (ms: number) => {
    clearTimeout(timer);
    if (!ctrl.signal.aborted && isVisible()) timer = setTimeout(tick, ms);
  };

  async function tick() {
    if (inFlight) return; // the request in flight schedules the next poll when it lands
    inFlight = true;
    try {
      await poll(ctrl.signal);
      failures = 0;
    } catch (err) {
      if (ctrl.signal.aborted) return;
      failures += 1; // 10 s, 20 s, 40 s, then once a minute
      onError(err);
    } finally {
      inFlight = false;
    }
    schedule(pollDelay(failures));
  }

  schedule(pollDelay(0));
  return {
    visibilityChanged: () => (isVisible() ? schedule(0) : clearTimeout(timer)),
    stop: () => {
      ctrl.abort();
      clearTimeout(timer);
    },
  };
}
