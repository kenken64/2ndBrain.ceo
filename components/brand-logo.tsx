import { useId } from "react";

type BrandLogoProps = {
  size?: number;
  className?: string;
  alt?: string;
};

export function BrandLogo({ size = 24, className, alt = "AI CUBER" }: BrandLogoProps) {
  const clipId = useId().replace(/:/g, "");
  return (
    <svg
      aria-label={alt}
      className={`app-logo ${className ?? ""}`}
      height={size}
      role="img"
      style={{ "--app-logo-size": `${size}px` } as React.CSSProperties}
      viewBox="0 0 2232 724"
      width={Math.round(size * 2232 / 724)}
    >
      <defs>
        <clipPath id={`${clipId}-mark`}><rect width="1040" height="724" /></clipPath>
        <clipPath id={`${clipId}-word`}><rect x="1040" width="1132" height="724" /></clipPath>
      </defs>
      <image clipPath={`url(#${clipId}-mark)`} height="724" href="/aicuber-logo.png" width="2172" />
      <g transform="translate(60 0)">
        <image clipPath={`url(#${clipId}-word)`} height="724" href="/aicuber-logo.png" width="2172" />
      </g>
    </svg>
  );
}

