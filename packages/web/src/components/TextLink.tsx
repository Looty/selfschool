import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { apiHref, isAppRoute } from "../basePath";

/**
 * A link from course or tutor text: app routes go through the router (so they follow the base path),
 * everything else opens in a new tab, with course-file links moved under the base.
 */
export function TextLink({ href, className, children }: { href: string | undefined; className?: string; children: ReactNode }) {
  if (href && isAppRoute(href))
    return (
      <Link to={href} className={className}>
        {children}
      </Link>
    );
  return (
    <a href={href && apiHref(href, import.meta.env.BASE_URL)} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}
