const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const filename = path.resolve(__dirname, "../lib/pomodoro.ts");
const instance = new Module(filename, module);
instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS }
}).outputText, filename);
const { advancePomodoro, newPomodoro, pausePomodoro, pomodoroRemaining, readPomodoroState, startPomodoro } = instance.exports;

test("focus sessions use the clock, pause accurately and count completion once", () => {
  const started = startPomodoro(newPomodoro(), 1000);
  assert.equal(pomodoroRemaining(started, 61_000), 24 * 60_000);
  const paused = pausePomodoro(started, 61_000);
  assert.equal(paused.endsAt, null);
  assert.equal(pomodoroRemaining(paused, 10_000_000), 24 * 60_000);
  const resumed = startPomodoro(paused, 10_000_000);
  const completed = advancePomodoro(resumed, resumed.endsAt + 1000);
  assert.equal(completed.completedFocusSessions, 1);
  assert.equal(completed.remainingMs, 0);
  assert.equal(completed.completed, true);
  assert.deepEqual(advancePomodoro(completed, resumed.endsAt + 2000), completed);
  assert.equal(startPomodoro(completed, resumed.endsAt + 3000).remainingMs, 25 * 60_000);
});

test("break completion does not count as a focus session", () => {
  for (const mode of ["shortBreak", "longBreak"]) {
    const running = startPomodoro(newPomodoro(mode, 2), 1000);
    assert.equal(advancePomodoro(running, running.endsAt).completedFocusSessions, 2);
  }
});

test("saved running timers resume after the page is closed; invalid data is ignored", () => {
  const running = startPomodoro(newPomodoro(), 1000);
  const restored = readPomodoroState(JSON.stringify(running));
  assert.equal(advancePomodoro(restored, running.endsAt + 5000).completedFocusSessions, 1);
  assert.deepEqual(readPomodoroState("{oops"), newPomodoro());
  assert.deepEqual(readPomodoroState(JSON.stringify({ ...running, remainingMs: -10 })), newPomodoro());
  assert.deepEqual(readPomodoroState(JSON.stringify({ ...running, mode: "unknown" })), newPomodoro());
});
