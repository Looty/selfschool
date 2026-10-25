import { lazy } from "react";
import { Route, Routes } from "react-router-dom";
import { Layout } from "./Layout";
import { Placeholder } from "./pages/Placeholder";

// One lazy chunk per feature; each folder is owned by one screen session (see FEATURES.md).
const Dashboard = lazy(() => import("./features/dashboard"));
const Course = lazy(() => import("./features/course"));
const Lesson = lazy(() => import("./features/lesson"));
const Quiz = lazy(() => import("./features/quiz"));
const Exam = lazy(() => import("./features/exam"));
const Extension = lazy(() => import("./features/extension"));
const Settings = lazy(() => import("./features/settings"));

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />

        {/* course feature: list at /courses, detail at /courses/:courseId */}
        <Route path="/courses" element={<Course />} />
        <Route path="/courses/:courseId" element={<Course />} />

        <Route path="/courses/:courseId/lessons/:lessonId" element={<Lesson />} />
        <Route path="/courses/:courseId/extensions/:extensionId" element={<Extension />} />
        <Route path="/courses/:courseId/quizzes/:quizId" element={<Quiz />} />

        {/* exam feature: info + take + result; /attempts/:attemptId is the result for quizzes and exams */}
        <Route path="/courses/:courseId/exams/:examId" element={<Exam />} />
        <Route path="/courses/:courseId/exams/:examId/take/:instanceId" element={<Exam />} />
        <Route path="/attempts" element={<Exam />} />
        <Route path="/attempts/:attemptId" element={<Exam />} />

        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Placeholder title="Not found" />} />
      </Route>
    </Routes>
  );
}
