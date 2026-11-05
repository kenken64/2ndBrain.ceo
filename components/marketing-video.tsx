"use client";

import { useState } from "react";

const VIDEO_URL = "https://d2ol7oe51mr4n9.cloudfront.net/user_3Di9GQZxjDZULtfGqAkwyOuipeb/4b52de18-b711-45f9-b965-18ec65d7ee43.mp4";

export function MarketingVideo({ locale }: { locale: "en" | "zh" }) {
  const [failed, setFailed] = useState(false);
  const zh = locale === "zh";
  return <>
    <div className="lp-video-player">
      <video controls playsInline preload="metadata" poster="/aicuber-video-poster.jpg" width={1920} height={1080} aria-label={zh ? "AI CUBER 宣传视频" : "AI CUBER marketing video"} onError={() => setFailed(true)}>
        <source src={VIDEO_URL} type="video/mp4" onError={() => setFailed(true)} />
        {zh ? "您的浏览器不支持视频播放，请使用下方链接打开视频。" : "Your browser does not support video playback. Use the link below to open the video."}
      </video>
    </div>
    {failed ? <p className="form-error" role="alert">{zh ? "视频暂时无法加载，请重试或使用下方链接直接打开。" : "The video could not load. Please try again or open it directly below."}</p> : null}
    <p className="lp-video-direct"><a href={VIDEO_URL} target="_blank" rel="noreferrer">{zh ? "直接打开视频 ↗" : "Open video directly ↗"}</a></p>
  </>;
}
