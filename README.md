# Selfschool

A personal, AI-native course platform that runs on your machine. You say "teach me X"; an AI agent researches it and writes a course (lessons, quizzes, exams, runnable labs, sources). Selfschool is the reader: course grid, lesson reader with a pinned tutor, quizzes, exams, progress, weak spots. One user, no accounts, nothing leaves your computer except the AI calls you make.

- **Courses are plain files** in their own git repo, for example [selfschool-courses](https://github.com/Looty/selfschool-courses). **Your progress is a SQLite file.** They never mix.
- **Two ways to run it:** in Docker (the default below), or entirely in a browser tab with no Docker (see [No Docker](#no-docker-run-it-entirely-in-the-browser-experimental)). Same app and same API in both.
- **The AI part is your own Claude CLI**, run on your machine by a small runner (chat, grading, extra questions). Without it the app still reads courses and runs quizzes.
- Design and decisions: [plan.md](plan.md). UI rules: [docs/ui.md](docs/ui.md).

## Quick start

All you need is **Docker Desktop**. The app runs in containers.

```bash
# the app and your courses, side by side
git clone https://github.com/Looty/selfschool.git
git clone https://github.com/Looty/selfschool-courses.git

cd selfschool
cp .env.example .env            # defaults work; edit only if a port is taken
docker compose up -d --build    # first run builds the image and installs dependencies (a few minutes)
```

Open **http://127.0.0.1:5174**. You can read courses, take quizzes and exams, and track progress now. The courses repo is mounted from `../selfschool-courses` (set `COURSES_PATH` in `.env` for another folder).

```bash
docker compose logs -f          # watch the api and web
docker compose restart api      # after changing API code (file changes on Windows do not reach the container)
docker compose down             # stop; your progress stays in the `selfschool-data` volume
```

### Turn on the AI tutor and grading (optional)

Chat, open-answer grading and generated questions run through **your own Claude CLI**, so they run on your machine, not in a container. You need Node 22 or newer and the [Claude CLI](https://docs.claude.com/en/docs/claude-code) installed and logged in:

```bash
corepack enable
pnpm install
pnpm build                      # once, builds the `school` command
pnpm school up                  # starts the containers (if they are not up) and the AI runner; Ctrl+C stops the runner
```

Without the runner everything else works, and AI features show "AI is paused".

| Command (host) | What it does |
|---|---|
| `pnpm school up` / `down` | Start / stop the containers and the runner |
| `pnpm school doctor` | Checks Docker, the API, the database, the runner and the Claude CLI |
| `pnpm school new-id "<title>"` | Prints a unique id for a new course |
| `pnpm school validate <course folder>` | Checks a course against the format rules |
| `pnpm school translate <course folder or id> --lang he` | Translates a course with your Claude CLI into `extensions/<id>/i18n/he/` (yours, the package is not touched). `--dry-run` sizes it first, a second run resumes, `--into-package` writes an author's own `i18n/`. Every file is checked (code blocks, links and quiz structure must come back unchanged) and retried; the app then offers the language in Settings and on the course page. Docker only: the browser build has no way to run it. |
| `pnpm test` / `pnpm typecheck` | Run the tests / the type checks |
| `pnpm check` | The whole CI sequence in one go: install, build, lint, typecheck, test |

Ports: web `5174`, API `3001` (both on `127.0.0.1` only).

### No Docker: run it entirely in the browser (experimental)

The same app and the same API can also run inside a browser tab, the way WordPress Playground runs WordPress. There is no server, no container and no account: SQLite runs as WebAssembly, courses live in an in-memory file system, and both are saved in your browser (IndexedDB). Nothing leaves the page except the requests you make to GitHub when you import a course. From a clone with `pnpm install` done:

```bash
pnpm --filter @selfschool/local dev   # then open http://localhost:5175/?sample=1 (the sample course loads on a first visit)
pnpm --filter @selfschool/local build # a static site in packages/local/dist that any file host can serve
```

- **Add courses** in Settings from a zip or a public GitHub URL (including a repo with several courses). GitHub imports use GitHub's web APIs, so no `git` is needed. Anonymous GitHub API calls are limited to 60 an hour.
- **Not available in this mode yet:** the AI tutor and AI grading (the runner needs your Claude CLI, which a page cannot reach), and imports from hosts other than github.com.
- **Your data stays in that browser.** Browsers can clear site data, so the dashboard reminds you to export a backup (Settings > Export backup) when you have progress and the last backup is missing or over two weeks old. This mode and the Docker setup are separate installs and do not share progress or courses, but the backup file is the same SQLite file in both, so a backup from one restores into the other.
- **Updates.** If you host the built site, a deploy replaces the app files under every visitor's browser while their data stays put: the database is upgraded on the next start, and an open tab shows a "new version available, reload" bar (your progress is saved before it reloads).
- **It runs next to Docker.** It uses its own port (`5175`) and storage, and shares no files with the containers, so both can be up at the same time.

### Deploy to GitHub Pages

`.github/workflows/pages.yml` publishes this browser build to GitHub Pages on every push to `main` (or by hand from the Actions tab). Turn it on once: Settings > Pages > Source: "GitHub Actions". The workflow builds the workspace, rebuilds `packages/local` for the `/selfschool/` sub-path, copies `index.html` to `404.html` so deep links survive a reload, and deploys `packages/local/dist`.

To build and check a sub-path build locally:

```bash
SELFSCHOOL_BASE=/selfschool/ pnpm --filter @selfschool/local build
pnpm --filter @selfschool/local exec vite preview --base /selfschool/
```

The deployed site is the same browser mode as above: progress lives in each visitor's browser, per site. To move between the hosted site, a local build and Docker, export a backup in one and restore it in the other.

## Add or create courses

**Add a ready-made course.** Settings → Course packages: paste a repository URL, tick the courses you want and import. A course from a repository is pinned to a commit, so you can see when its author updates it. You can also drop a course `.zip` there, or just copy a course folder into your courses folder.

### Keep a course up to date, or switch version

Each installed course remembers where it came from: the repo URL, the path inside it, the branch or tag (`ref`) and the commit. In Settings > Course packages, **Check for updates** asks GitHub (on demand, never automatically: anonymous calls are limited to 60 an hour) whether that branch or tag has moved, and lists the repo's other branches and tags. **Review changes** (or **Switch to v1.1** after picking another version) opens the usual import popup, which checks the new version first and then updates the course in place. Your progress is kept; lessons that changed are flagged. This works for courses installed from a GitHub URL; zip and local-folder courses have nothing to check.

### Example courses

[selfschool-courses](https://github.com/Looty/selfschool-courses) is a public repository with three finished courses you can import to see what a course looks like:

| Course | Folder in the repository | What it is |
|---|---|---|
| [How LLMs Work: From Zero to Your Own](https://github.com/Looty/selfschool-courses/tree/main/how-llms-work-from-zero-to-your-own-2iy8t7) | `how-llms-work-from-zero-to-your-own-2iy8t7` | About 13 hours, 13 chapters, 65 lessons, Python labs you run yourself. For engineers new to ML. |
| [MLOps from Zero to Production](https://github.com/Looty/selfschool-courses/tree/main/mlops-from-zero-to-production-gblt3l) | `mlops-from-zero-to-production-gblt3l` | 52 lessons with hands-on labs. |
| [TypeScript Fundamentals](https://github.com/Looty/selfschool-courses/tree/main/typescript-fundamentals) | `typescript-fundamentals` | 12 short lessons, plus a demo of every question type. |

How to import them:

1. Start the app (`docker compose up -d`) and open **http://127.0.0.1:5174/settings**.
2. Scroll to **Course packages**. Under **Repository URL** enter `https://github.com/Looty/selfschool-courses`.
3. Leave **Path** empty (it means the repository root) and leave **Ref** as `main`.
4. Click **Check package**. The app clones the repository, sees that it holds three courses and lists them. Each row shows the title, lesson count, level and a status: *New*, *Installed; import replaces it*, or *Already installed from another source* (that one cannot be ticked).
5. Tick the courses you want. All new ones start ticked; use **Select all** or **Select none** to change that.
6. Click **Import N courses**. They are added one by one, each row ends with *Added* (or the reason it failed), and **Open courses** takes you to them.

To import just one course, type its folder name in **Path** (for example `typescript-fundamentals`) before clicking **Check package**. The popup then shows a preview of its chapters, lessons and quizzes before you confirm.

If a course already sits in your courses folder (for example because you cloned that repository next to the app), the app lists it from there and the import is refused for the same course id. Remove it in Settings first if you want it installed from the repository instead; removing a course also deletes your progress in it.

**Make a new course with an AI agent** (this is what most people want):

1. Install the authoring skill once. For Claude Code:
   ```bash
   mkdir -p ~/.claude/skills && cp -r skill ~/.claude/skills/selfschool-course
   ```
   (PowerShell: `Copy-Item -Recurse skill $HOME\.claude\skills\selfschool-course`.) Other agents and plain chat models: see [skill/README.md](skill/README.md).
2. Start the agent **inside your courses folder** and ask for what you want to learn:
   ```bash
   cd ../selfschool-courses
   claude
   > teach me how Kubernetes scheduling works, I am a backend engineer, about 3 hours
   ```
3. The agent asks a few questions (depth, what you already know, prerequisites), researches the topic on the web, shows you an outline to approve, then writes `<course-id>/` with lessons, quizzes, exams and lab files. It validates the result itself.
4. The new folder shows up in the app on its next refresh (a few seconds). Read the first lesson and one quiz yourself: validation checks structure and citations, not whether a claim is true.

Longer courses cost more research: the skill fetches and reads real sources (about 5 for a 15-minute course up to 60 or more for a 12-hour one) and cites every claim. Quality over speed.

**Extend a course you already have.** On a course page, "Propose topics" drafts an outline of extra chapters for you to approve. Then *Copy brief* gives you a brief for the authoring agent (real sources), or *Generate here* has the runner write lessons from model knowledge, clearly labelled unverified. Extensions live next to the course (`extensions/`), never inside it, so updating the course cannot overwrite them.

## If you are an AI agent

- To **author or extend a course**, read and follow [skill/SKILL.md](skill/SKILL.md). It is the whole format reference; [skill/templates/](skill/templates/) has a starter for every file. Do not write course content from memory: fetch and read sources, cite them, and say when you could not.
- Write each course as `<id>/` at the top of the **courses folder** (the `selfschool-courses` repository, not this one). Never edit an existing course to extend it; use `extensions/<id>/`.
- Run `pnpm school validate <folder>` from this repository and fix every error before you hand a course back. Warnings are worth fixing too.
- Working on the **app code**: read [plan.md](plan.md) first. Change files with small, reviewable edits. Personal tool, single user, no auth: do not add multi-tenancy or over-engineer.
- No personal data in the repository or in courses (names, emails, local paths, keys).

## Repository layout

```
packages/shared   zod schemas and the course validator (the format lives here)
packages/api      Hono + SQLite API (reads courses, stores progress)
packages/web      React app
packages/runner   host process that runs the Claude CLI for chat, grading and generation
packages/cli      the `school` command
packages/local    runs the web app and the api in a browser tab, no Docker (browser shims only; the other packages are unchanged)
skill/            the course-authoring skill and its templates
examples/         sample courses used as test fixtures
docker/           the one image used by the dev containers
```

## Licence

[MIT](LICENSE). Courses carry their own licence in their repository.
