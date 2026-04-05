export const ACTIVE_PROCESSES_REFRESH_EVENT = "viss:active-processes-refresh";

export function dispatchActiveProcessesRefresh() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(ACTIVE_PROCESSES_REFRESH_EVENT));
}