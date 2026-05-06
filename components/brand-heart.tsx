type BrandHeartProps = {
  size?: number;
  className?: string;
  alt?: string;
};

export function BrandHeart({ size = 24, className, alt = "Nth Brain logo" }: BrandHeartProps) {
  return (
    <img
      alt={alt}
      className={`app-logo ${className ?? ""}`}
      height={size}
      src="/logo-app.png"
      style={{ "--app-logo-size": `${size}px` } as React.CSSProperties}
      width={Math.round(size * 1.869)}
    />
  );
}
