import Image from "next/image";
import Link from "next/link";

export function BrandLink({
  className = "",
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <Link
      href="/"
      className={`brand-link${compact ? " brand-link-compact" : ""} ${className}`.trim()}
      aria-label="Do-It home"
    >
      <span className="brand-mark" aria-hidden="true">
        <picture className="brand-mark-picture">
          <source
            media="(prefers-color-scheme: dark)"
            srcSet="/brand/do-it-mark-dark.png"
          />
          <Image
            src="/brand/do-it-mark.png"
            alt=""
            width={64}
            height={64}
            className="brand-mark-image"
          />
        </picture>
      </span>
      <span>Do-It</span>
    </Link>
  );
}
