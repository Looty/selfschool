import type { HotspotRegion } from "./course.js";

export interface Point {
  x: number;
  y: number;
}

/** Whether a point (percent of the image) lies inside a region. Used by the api to grade and by the ui to draw. */
export function regionContains(r: HotspotRegion, p: Point): boolean {
  switch (r.shape) {
    case "rect":
      return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    case "ellipse": {
      if (r.rx === 0 || r.ry === 0) return false;
      return ((p.x - r.x) / r.rx) ** 2 + ((p.y - r.y) / r.ry) ** 2 <= 1;
    }
    case "poly": {
      let inside = false;
      for (let i = 0, j = r.points.length - 1; i < r.points.length; j = i++) {
        const [xi, yi] = r.points[i]!;
        const [xj, yj] = r.points[j]!;
        if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }
  }
}

/** The first region that holds the point, preferring correct ones so an overlapping decoy never hides the answer. */
export function regionAt(regions: HotspotRegion[], p: Point): HotspotRegion | undefined {
  return regions.find((r) => r.correct && regionContains(r, p)) ?? regions.find((r) => regionContains(r, p));
}
