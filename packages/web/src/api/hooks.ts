import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RouteInput, RouteName, RouteResponse } from "@selfschool/shared";
import { callApi } from "./client";

type Args<N extends RouteName> = {} extends RouteInput<N> ? [input?: RouteInput<N>] : [input: RouteInput<N>];

interface QueryOpts<N extends RouteName> {
  enabled?: boolean;
  /** Poll while this returns a number (ms), e.g. while an AI job is pending. */
  poll?: (data: RouteResponse<N> | undefined) => number | false;
}

/** Cache key shared by every hook: ["api", routeName, input]. */
export const apiKey = (name: RouteName, input?: unknown) => (input === undefined ? ["api", name] : ["api", name, input]);

/** Generic typed query for any route in the shared table. */
export function useApiQuery<N extends RouteName>(name: N, input: RouteInput<N> | undefined, opts: QueryOpts<N> = {}) {
  return useQuery({
    queryKey: apiKey(name, input),
    queryFn: () => callApi(name, ...((input === undefined ? [] : [input]) as unknown as Args<N>)),
    enabled: opts.enabled,
    refetchInterval: opts.poll ? (q) => opts.poll!(q.state.data as RouteResponse<N> | undefined) : undefined,
  });
}

/** Generic typed mutation; `invalidate` lists route names whose cached queries are refetched on success. */
export function useApiMutation<N extends RouteName>(name: N, invalidate: RouteName[] = []) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RouteInput<N>) => callApi(name, ...([input] as unknown as Args<N>)),
    onSuccess: () => Promise.all(invalidate.map((n) => qc.invalidateQueries({ queryKey: ["api", n] }))),
  });
}

// ---------- per-endpoint hooks (screens import these, not the generic ones) ----------

const AFTER_PROGRESS: RouteName[] = ["lesson", "course", "courses", "dashboard"];

export const useDashboard = () => useApiQuery("dashboard", undefined);
export const useCourses = () => useApiQuery("courses", undefined);
export const useCourse = (courseId: string) => useApiQuery("course", { params: { courseId } });
export const useLesson = (courseId: string, lessonId: string) => useApiQuery("lesson", { params: { courseId, lessonId } });
export const useCompleteLesson = () => useApiMutation("completeLesson", AFTER_PROGRESS);
export const useProposeExtension = () => useApiMutation("proposeExtension", ["job", "extensions"]);
export const useExtensions = (courseId: string) => useApiQuery("extensions", { params: { courseId } });
/** Polls while the outline is still being drafted. */
export const useExtension = (extensionId: string | undefined) =>
  useApiQuery("extension", { params: { extensionId: extensionId ?? "" } }, { enabled: !!extensionId, poll: (d) => (d?.status === "drafting" || d?.generation?.state === "running" ? 1500 : false) });
export const useRedraftExtension = () => useApiMutation("redraftExtension", ["extension", "extensions"]);
export const useDecideExtension = () => useApiMutation("decideExtension", ["extension", "extensions"]);
export const useExtensionBrief = (extensionId: string, enabled: boolean) => useApiQuery("extensionBrief", { params: { extensionId } }, { enabled });
export const useGenerateExtension = () => useApiMutation("generateExtension", ["extension", "extensions", "extensionBrief"]);
export const useResumeExtension = () => useApiMutation("resumeExtension", ["extension", "extensions"]);

export const useChat = (courseId: string, lessonId: string) =>
  useApiQuery("chat", { params: { courseId, lessonId } }, { poll: (d) => (d?.messages.some((m) => m.status === "pending") ? 700 : false) });
export const useAsk = () => useApiMutation("ask", ["chat", "lesson"]);

export const useQuiz = (courseId: string, quizId: string) => useApiQuery("quiz", { params: { courseId, quizId } });
export const useStartQuizAttempt = () => useApiMutation("startQuizAttempt", ["quiz"]);
export const useSubmitAnswer = () => useApiMutation("submitAnswer", ["attempt"]);
export const useAttempts = () => useApiQuery("attempts", undefined);
export const useDeleteAttempt = () => useApiMutation("deleteAttempt", ["attempts", "attempt", "course", "courses", "dashboard", "exam"]);
export const useFinishAttempt = () => useApiMutation("finishAttempt", ["attempt", "course", "courses", "dashboard", "exam"]);
/** Polls every 2s while AI-graded answers are outstanding. */
export const useAttempt = (attemptId: string | undefined) =>
  useApiQuery("attempt", { params: { attemptId: attemptId ?? "" } }, { enabled: !!attemptId, poll: (d) => (d && d.score.pendingCount > 0 ? 2000 : false) });

export const useExam = (courseId: string, examId: string) => useApiQuery("exam", { params: { courseId, examId } });
export const useStartExam = () => useApiMutation("startExam", ["exam", "course"]);
export const useRegenerateExam = () => useApiMutation("regenerateExam", ["exam", "course"]);
export const useExamInstance = (instanceId: string | undefined) =>
  useApiQuery("examInstance", { params: { instanceId: instanceId ?? "" } }, { enabled: !!instanceId });
export const useReportQuestion = () => useApiMutation("reportQuestion", ["attempt"]);

export const useJob = (id: string | undefined) =>
  useApiQuery("job", { params: { id: id ?? "" } }, { enabled: !!id, poll: (d) => (d && (d.status === "pending" || d.status === "running") ? 1500 : false) });

export const useSettings = () => useApiQuery("settings", undefined);
export const useUpdateSettings = () => useApiMutation("updateSettings", ["settings"]);
export const usePackages = () => useApiQuery("packages", undefined);
export const useAddPackage = () => useApiMutation("addPackage", ["packages", "courses", "dashboard"]);
