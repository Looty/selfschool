import type { ExtensionView, OutlineResult } from "@selfschool/shared";

/** The outline as the learner edits it: every lesson can be left out, titles can be renamed. */
export interface Draft {
  title: string;
  rationale: string;
  unverified: boolean;
  chapters: { title: string; why: string; lessons: { title: string; objective: string; why: string; included: boolean }[] }[];
}

export const toDraft = (o: OutlineResult): Draft => ({
  ...o,
  chapters: o.chapters.map((c) => ({ ...c, lessons: c.lessons.map((l) => ({ ...l, included: true })) })),
});

export const includedCount = (d: Draft) => d.chapters.reduce((n, c) => n + c.lessons.filter((l) => l.included).length, 0);

const blank = (s: string) => s.trim() === "";

/** Approvable when something is left and every kept title has text. */
export function canApprove(d: Draft): boolean {
  if (includedCount(d) === 0 || blank(d.title)) return false;
  return d.chapters.every((c) => !c.lessons.some((l) => l.included) || (!blank(c.title) && c.lessons.every((l) => !l.included || !blank(l.title))));
}

/** What gets saved: kept lessons only, chapters with none dropped, text trimmed. */
export function toOutline(d: Draft): OutlineResult {
  return {
    title: d.title.trim(),
    rationale: d.rationale,
    unverified: d.unverified,
    chapters: d.chapters
      .map((c) => ({
        title: c.title.trim(),
        why: c.why,
        lessons: c.lessons.filter((l) => l.included).map((l) => ({ title: l.title.trim(), objective: l.objective, why: l.why })),
      }))
      .filter((c) => c.lessons.length > 0),
  };
}

export const isDrafting = (e: Pick<ExtensionView, "status"> | undefined) => e?.status === "drafting";

/** Where an open proposal for the course page points: review it, or just show where it stands. */
export function proposalLine(e: Pick<ExtensionView, "status">): string {
  switch (e.status) {
    case "drafting":
      return "Drafting an outline…";
    case "ready":
      return "Outline ready to review";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "failed":
      return "Drafting failed";
  }
}
