# Selfschool

A personal, AI-native course platform that runs on your machine. You say "teach me X"; an AI agent researches it and writes a course (lessons, quizzes, exams, runnable labs, sources). Selfschool is the reader: course grid, lesson reader with a pinned tutor, quizzes, exams, progress, weak spots. One user, no accounts, nothing leaves your computer except the AI calls you make.

- **Courses are plain files** in their own git repo, for example [selfschool-courses](https://github.com/Looty/selfschool-courses). **Your progress is a SQLite file.** They never mix.
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
| `pnpm test` / `pnpm typecheck` | Run the tests / the type checks |

Ports: web `5174`, API `3001` (both on `127.0.0.1` only).

## Add or create courses

**Add a ready-made course.** Settings → Course packages: paste a repository URL, tick the courses you want and import. A course from a repository is pinned to a commit, so you can see when its author updates it. You can also drop a course `.zip` there, or just copy a course folder into your courses folder.

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
skill/            the course-authoring skill and its templates
examples/         sample courses used as test fixtures
docker/           the one image used by the dev containers
```

## Licence

[MIT](LICENSE). Courses carry their own licence in their repository.
