"use client";

import { Pause, Play, RotateCcw, Timer } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { Localized, useLanguage } from "@/components/language-provider";
import { advancePomodoro, newPomodoro, pausePomodoro, POMODORO_DURATIONS, pomodoroRemaining, readPomodoroState, startPomodoro, type PomodoroMode, type PomodoroState } from "@/lib/pomodoro";

const modes: Array<{ id: PomodoroMode; en: string; zh: string }> = [
  { id: "focus", en: "Focus", zh: "专注" },
  { id: "shortBreak", en: "Short break", zh: "短休息" },
  { id: "longBreak", en: "Long break", zh: "长休息" }
];

function displayTime(milliseconds: number) {
  const seconds = Math.ceil(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function PomodoroTimer({ userId }: { userId: string }) {
  const { language } = useLanguage();
  const zh = language === "zh";
  const [timer, setTimer] = useState<PomodoroState | null>(null);
  const [now, setNow] = useState(0);
  const storageKey = `aicuber:pomodoro:${userId}`;

  useEffect(() => {
    const current = Date.now();
    setNow(current);
    try {
      setTimer(advancePomodoro(readPomodoroState(window.localStorage.getItem(storageKey)), current));
    } catch {
      setTimer(newPomodoro());
    }
  }, [storageKey]);

  useEffect(() => {
    if (!timer) return;
    try { window.localStorage.setItem(storageKey, JSON.stringify(timer)); } catch { /* The timer still works for this session. */ }
  }, [storageKey, timer]);

  useEffect(() => {
    if (!timer?.endsAt) return;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      setTimer((previous) => previous ? advancePomodoro(previous, current) : previous);
    };
    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [timer?.endsAt]);

  if (!timer) {
    return <p className="pomodoro-loading"><Localized en="Loading your timer…" zh="正在加载计时器…" /></p>;
  }

  const remaining = pomodoroRemaining(timer, now);
  const progress = Math.max(0, Math.min(100, (1 - remaining / POMODORO_DURATIONS[timer.mode]) * 100));
  const running = timer.endsAt !== null;
  const paused = !running && !timer.completed && remaining < POMODORO_DURATIONS[timer.mode];
  const activeMode = modes.find((mode) => mode.id === timer.mode)!;

  return (
    <div className="pomodoro-layout">
      <section aria-labelledby="pomodoro-title" className="pomodoro-card">
        <div className="pomodoro-card__intro">
          <span aria-hidden="true" className="pomodoro-card__icon"><Timer size={23} strokeWidth={1.8} /></span>
          <div>
            <p className="pomodoro-card__eyebrow"><Localized en="YOUR FOCUS SPACE" zh="您的专注空间" /></p>
            <h1 id="pomodoro-title"><Localized en="Pomodoro Timer" zh="番茄钟" /></h1>
          </div>
        </div>
        <p className="pomodoro-card__description"><Localized en="Make space for focused work, then give yourself a break." zh="留出专注工作的时间，然后好好休息一下。" /></p>

        <div aria-label={zh ? "选择计时阶段" : "Choose a timer session"} className="pomodoro-modes" role="group">
          {modes.map((mode) => (
            <button aria-pressed={timer.mode === mode.id} className={timer.mode === mode.id ? "is-active" : ""} key={mode.id} onClick={() => { setTimer(newPomodoro(mode.id, timer.completedFocusSessions)); setNow(Date.now()); }} type="button">
              {zh ? mode.zh : mode.en}
            </button>
          ))}
        </div>

        <div aria-label={zh ? `${activeMode.zh}，剩余 ${displayTime(remaining)}` : `${activeMode.en}, ${displayTime(remaining)} remaining`} className="pomodoro-dial" role="timer" style={{ "--pomodoro-progress": `${progress}%` } as CSSProperties}>
          <div className="pomodoro-dial__inside">
            <span>{zh ? activeMode.zh : activeMode.en}</span>
            <strong>{displayTime(remaining)}</strong>
            <small>{timer.completed ? (zh ? "已完成" : "Complete") : running ? (zh ? "进行中" : "In progress") : paused ? (zh ? "已暂停" : "Paused") : (zh ? "准备就绪" : "Ready when you are")}</small>
          </div>
        </div>

        <div aria-live="polite" className="pomodoro-announcement">
          {timer.completed ? (timer.mode === "focus" ? (zh ? "专注时段已完成。休息一下吧。" : "Focus session complete. Time for a break.") : (zh ? "休息结束。准备好继续专注了吗？" : "Break complete. Ready to focus again?")) : ""}
        </div>
        <div className="pomodoro-actions">
          <button className="btn-primary pomodoro-actions__start" onClick={() => { const current = Date.now(); setNow(current); setTimer(running ? pausePomodoro(timer, current) : startPomodoro(timer, current)); }} type="button">
            {running ? <Pause aria-hidden="true" size={17} /> : <Play aria-hidden="true" size={17} />}
            {running ? <Localized en="Pause" zh="暂停" /> : timer.completed ? <Localized en="Start again" zh="再次开始" /> : paused ? <Localized en="Resume" zh="继续" /> : <Localized en="Start" zh="开始" />}
          </button>
          <button className="btn-ghost pomodoro-actions__reset" onClick={() => { setTimer(newPomodoro(timer.mode, timer.completedFocusSessions)); setNow(Date.now()); }} type="button">
            <RotateCcw aria-hidden="true" size={17} /><Localized en="Reset" zh="重置" />
          </button>
        </div>
        <div className="pomodoro-card__footer">
          <span><Localized en="Completed focus sessions" zh="已完成的专注次数" /></span>
          <strong>{timer.completedFocusSessions}</strong>
        </div>
      </section>
      <p className="pomodoro-note"><Localized en="Your timer is saved in this browser and keeps time while you’re away." zh="计时器保存在当前浏览器中，离开页面后仍会继续计时。" /></p>
    </div>
  );
}
