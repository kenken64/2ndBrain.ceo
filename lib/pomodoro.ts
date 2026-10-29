export const POMODORO_DURATIONS = {
  focus: 25 * 60_000,
  shortBreak: 5 * 60_000,
  longBreak: 15 * 60_000
} as const;

export type PomodoroMode = keyof typeof POMODORO_DURATIONS;
export type PomodoroState = {
  mode: PomodoroMode;
  remainingMs: number;
  endsAt: number | null;
  completedFocusSessions: number;
  completed: boolean;
};

export function newPomodoro(mode: PomodoroMode = "focus", completedFocusSessions = 0): PomodoroState {
  return { mode, remainingMs: POMODORO_DURATIONS[mode], endsAt: null, completedFocusSessions, completed: false };
}

export function pomodoroRemaining(state: PomodoroState, now: number) {
  return Math.max(0, state.endsAt === null ? state.remainingMs : state.endsAt - now);
}

export function advancePomodoro(state: PomodoroState, now: number): PomodoroState {
  if (state.endsAt === null || state.endsAt > now) return state;
  return {
    ...state,
    remainingMs: 0,
    endsAt: null,
    completed: true,
    completedFocusSessions: state.completedFocusSessions + (state.mode === "focus" ? 1 : 0)
  };
}

export function startPomodoro(state: PomodoroState, now: number): PomodoroState {
  const current = advancePomodoro(state, now);
  if (current.endsAt !== null) return current;
  const remainingMs = current.completed ? POMODORO_DURATIONS[current.mode] : current.remainingMs;
  return { ...current, remainingMs, endsAt: now + remainingMs, completed: false };
}

export function pausePomodoro(state: PomodoroState, now: number): PomodoroState {
  const current = advancePomodoro(state, now);
  if (current.endsAt === null) return current;
  return { ...current, remainingMs: pomodoroRemaining(current, now), endsAt: null };
}

export function readPomodoroState(raw: string | null): PomodoroState {
  if (!raw) return newPomodoro();
  try {
    const value = JSON.parse(raw) as Partial<PomodoroState>;
    if (!value || typeof value !== "object" || !Object.hasOwn(POMODORO_DURATIONS, value.mode ?? "")) return newPomodoro();
    const mode = value.mode as PomodoroMode;
    if (typeof value.remainingMs !== "number" || !Number.isFinite(value.remainingMs) || value.remainingMs < 0 || value.remainingMs > POMODORO_DURATIONS[mode]) return newPomodoro();
    if (value.endsAt !== null && (typeof value.endsAt !== "number" || !Number.isFinite(value.endsAt) || value.endsAt < 0)) return newPomodoro();
    if (typeof value.completedFocusSessions !== "number" || !Number.isSafeInteger(value.completedFocusSessions) || value.completedFocusSessions < 0) return newPomodoro();
    if (typeof value.completed !== "boolean" || (value.completed && value.endsAt !== null)) return newPomodoro();
    return value as PomodoroState;
  } catch {
    return newPomodoro();
  }
}
