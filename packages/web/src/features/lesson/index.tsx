import "./lesson.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ChatMessage } from "@selfschool/shared";
import { ApiError } from "../../api/client";
import { useAsk, useChat, useCompleteLesson, useLesson, useProposeExtension } from "../../api/hooks";
import { textDirection } from "../../api/language";
import { Button } from "../../ui";
import { BottomStack } from "../run/BottomStack";
import { EditorDrawer, useDrawerCovers } from "../run/EditorDrawer";
import { LabProvider, useLab } from "../run/lab";
import { LabDock } from "../run/LabDock";
import { Article } from "./Article";
import { AskBar } from "./AskBar";
import { LessonBand } from "./LessonBand";
import { ReadingProgress } from "./ReadingProgress";
import { Thread, type ProposeState } from "./Thread";
import { useReadingFont } from "./useReadingFont";

function Skeleton() {
  return (
    <div role="status" aria-label="Loading lesson" className="mx-auto w-full max-w-[calc(940px*var(--content-scale,1))] px-7 py-11">
      <span className="visually-hidden">Loading lesson…</span>
      <div aria-hidden className="flex animate-pulse flex-col gap-4">
        <div className="h-3 w-48 rounded bg-surface2" />
        <div className="h-10 w-2/3 rounded bg-surface2" />
        <div className="h-5 w-full max-w-[78ch] rounded bg-surface2" />
        <div className="mt-6 h-4 w-full rounded bg-surface2" />
        <div className="h-4 w-11/12 rounded bg-surface2" />
        <div className="h-4 w-4/5 rounded bg-surface2" />
        <div className="h-32 w-full rounded-[10px] bg-surface2" />
      </div>
    </div>
  );
}

function Failure({ error, courseId, onRetry }: { error: unknown; courseId: string; onRetry: () => void }) {
  const notFound = error instanceof ApiError && error.status === 404;
  return (
    <div role="alert" className="mx-auto w-full max-w-[calc(940px*var(--content-scale,1))] px-7 py-16">
      <h1 className="m-0 text-2xl font-semibold tracking-tight">{notFound ? "Lesson not found" : "Couldn't load this lesson"}</h1>
      <p className="mb-5 mt-2 text-text2">{notFound ? "This lesson doesn't exist in the course, or the course package changed." : error instanceof Error ? error.message : "Something went wrong."}</p>
      <div className="flex gap-3">
        {notFound ? null : (
          <Button variant="primary" onClick={onRetry}>
            Retry
          </Button>
        )}
        <Button to={`/courses/${courseId}`}>Back to course</Button>
      </div>
    </div>
  );
}

const NO_RESOURCES: readonly { name: string; url: string }[] = [];

/**
 * The lesson page inside the course's lab. The lab (docked terminal, editor drawer, run engine) wraps the loading and
 * error states too, so moving to the next lesson keeps the terminal and a loaded Python.
 */
export default function LessonFeature() {
  const { courseId = "", lessonId = "" } = useParams();
  const lessonQ = useLesson(courseId, lessonId);
  return (
    <LabProvider courseId={courseId} resources={lessonQ.data?.resources ?? NO_RESOURCES}>
      <LessonPage courseId={courseId} lessonId={lessonId} />
    </LabProvider>
  );
}

function LessonPage({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const navigate = useNavigate();
  const lessonQ = useLesson(courseId, lessonId);
  const chatQ = useChat(courseId, lessonId);
  const ask = useAsk();
  const complete = useCompleteLesson();
  const propose = useProposeExtension();
  const { family } = useReadingFont();
  const lab = useLab();
  const drawerCovers = useDrawerCovers();

  const [draft, setDraft] = useState("");
  const [quote, setQuote] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Record<number, ProposeState>>({});
  const input = useRef<HTMLInputElement>(null);

  // A new lesson starts at the top with a clean ask box.
  useEffect(() => {
    window.scrollTo(0, 0);
    setDraft("");
    setQuote(null);
    setProposals({});
  }, [courseId, lessonId]);

  const lesson = lessonQ.data;
  const sources = useMemo(() => new Set(lesson?.sources.map((s) => s.n) ?? []), [lesson?.sources]);

  // the terminal stays on screen (and keeps its state) while the next lesson loads
  if (lessonQ.isPending || lessonQ.isError || !lesson) {
    return (
      <>
        {lessonQ.isPending ? <Skeleton /> : <Failure error={lessonQ.error} courseId={courseId} onRetry={() => lessonQ.refetch()} />}
        <BottomStack>
          <LabDock />
        </BottomStack>
      </>
    );
  }

  const messages = chatQ.data?.messages ?? [];
  const aiAvailable = chatQ.data?.ai.available ?? lesson.ai.available;
  const done = messages.filter((m) => m.role === "assistant" && m.status === "done").length;
  const answerCount = chatQ.data ? done : lesson.answerCount;

  const askAbout = (q: string) => {
    setQuote(q);
    input.current?.focus();
  };

  const send = () => {
    const question = draft.trim();
    if (!question || !aiAvailable) return;
    ask.mutate(
      { params: { courseId, lessonId }, body: { question, ...(quote ? { selection: quote } : {}) } },
      {
        onSuccess: () => {
          setDraft("");
          setQuote(null);
          document.getElementById("thread")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
        },
      },
    );
  };

  const proposeExtension = (m: ChatMessage, question: string) => {
    setProposals((p) => ({ ...p, [m.id]: "pending" }));
    propose.mutate(
      // chat is not kept, so the proposal carries the question and the tutor's (unverified) answer itself
      { params: { courseId }, body: { ...(question ? { question } : {}), ...(m.content ? { answer: m.content } : {}), fromLessonId: lessonId } },
      {
        onSuccess: (r) => {
          setProposals((p) => ({ ...p, [m.id]: "done" }));
          navigate(`/courses/${courseId}/extensions/${r.extensionId}`);
        },
        onError: () => setProposals((p) => ({ ...p, [m.id]: "error" })),
      },
    );
  };

  // the same shape as the loading branch above (page, then the bottom stack), so the terminal stays mounted across it
  return (
    <>
    <div data-hue={lesson.course.hue} className="flex min-h-[calc(100vh-56px-var(--lab-bottom,0px))] flex-col bg-bg">
      <LessonBand lesson={lesson} />
      <ReadingProgress resetKey={`${courseId}/${lessonId}`} />
      {/* the lesson, with the lab's editor drawer beside it (over it on narrow screens) */}
      <div className="flex grow items-start">
        {/* on a narrow screen the open editor covers the lesson: the lesson behind it takes no focus or clicks */}
        <div className="flex min-w-0 flex-1 flex-col self-stretch" inert={!!lab?.editing && drawerCovers}>
          <div dir={textDirection(lesson.language)} lang={lesson.language} className="contents">
            <Article
              lesson={lesson}
              fontFamily={family}
              onAsk={askAbout}
              onComplete={() => complete.mutate({ params: { courseId, lessonId } })}
              onNext={() => {
                const next = lesson.next;
                if (!next) return;
                // Moving on from a quiz-less lesson counts as finishing it; a failed save must not trap the reader.
                complete.mutate({ params: { courseId, lessonId } }, { onSettled: () => navigate(`/courses/${courseId}/lessons/${next.id}`) });
              }}
              completing={complete.isPending}
            />
          </div>
          {complete.isError ? (
            <p role="alert" className="mx-auto -mt-8 mb-8 w-full max-w-[calc(940px*var(--content-scale,1))] px-7 text-sm text-bad">
              Couldn't mark the lesson complete. <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-bad underline" onClick={() => complete.mutate({ params: { courseId, lessonId } })}>Try again</button>
            </p>
          ) : null}
          <Thread
            courseId={courseId}
            chapters={lesson.chapters}
            messages={messages}
            aiAvailable={aiAvailable}
            sources={sources}
            unverified={chatQ.data?.unverified ?? lesson.origin === "quick"}
            loading={chatQ.isPending}
            error={chatQ.isError}
            onRetry={() => chatQ.refetch()}
            proposeState={(m) => proposals[m.id] ?? "idle"}
            onPropose={proposeExtension}
          />
        </div>
        <EditorDrawer className="fixed inset-x-0 top-0 z-30 shadow-[-12px_0_30px_rgba(11,18,32,0.18)] lg:sticky lg:inset-x-auto lg:z-10 lg:w-[var(--drawer-w)] lg:shrink-0" />
      </div>
    </div>
      <BottomStack>
        <LabDock />
        <AskBar
          pinned={false}
          aiAvailable={aiAvailable}
          answerCount={answerCount}
          value={draft}
          onChange={setDraft}
          quote={quote}
          onClearQuote={() => setQuote(null)}
          onSend={send}
          sending={ask.isPending}
          error={ask.isError ? "Couldn't send your question. Try again." : null}
          inputRef={input}
        />
      </BottomStack>
    </>
  );
}
