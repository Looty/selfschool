import { useParams } from "react-router-dom";
import { AttemptsListPage } from "./AttemptsList";
import { ExamInfoPage } from "./Info";
import { ExamResultPage } from "./Result";
import { ExamTake } from "./Take";

/** One lazy chunk, four routes: info, take, result, and the attempts list (see App.tsx). */
export default function ExamFeature() {
  const { courseId, examId, instanceId, attemptId } = useParams();
  if (instanceId) return <ExamTake key={instanceId} instanceId={instanceId} />;
  if (attemptId) return <ExamResultPage key={attemptId} attemptId={attemptId} />;
  if (courseId && examId) return <ExamInfoPage key={`${courseId}/${examId}`} courseId={courseId} examId={examId} />;
  return <AttemptsListPage />;
}
