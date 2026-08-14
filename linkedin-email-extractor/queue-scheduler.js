export function createQueueScheduler(runPump, options = {}) {
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const now = options.now || Date.now;
  const onError = options.onError || ((error) => console.error(error));
  let timerId = null;
  let dueAt = null;

  function clear() {
    if (timerId !== null) clearTimer(timerId);
    timerId = null;
    dueAt = null;
  }

  function schedule(delayMs) {
    const delay = Math.max(0, Number(delayMs) || 0);
    const requestedDueAt = now() + delay;

    // Keep an existing earlier refill. Repeated completion events must not
    // postpone an immediate pump until the rest of the active batch finishes.
    if (timerId !== null && dueAt <= requestedDueAt) return;

    clear();
    dueAt = requestedDueAt;
    timerId = setTimer(() => {
      timerId = null;
      dueAt = null;
      try {
        Promise.resolve(runPump()).catch(onError);
      } catch (error) {
        onError(error);
      }
    }, delay);
  }

  return {
    clear,
    schedule,
    getDueAt: () => dueAt,
  };
}
