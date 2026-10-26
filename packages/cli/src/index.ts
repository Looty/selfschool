#!/usr/bin/env node
import { doctor, down, newId, translate, up, validate } from "./commands.js";

const USAGE = `usage: school <command>

  up                start containers (docker compose) and the runner in the foreground
  down              stop the runner and the containers
  doctor [--ai]     check docker, api, db, runner, claude CLI (--ai: one cheap live claude call)
  new-id <title>    print a unique id for a new course (title slug + random suffix); ids never change after publish
  translate <course> --lang <code>
                    translate a course with your Claude CLI into extensions/<id>/i18n/<code>/ (--into-package for
                    an author's own i18n/, --dry-run to size it, --force to start over; resumes by default)
  validate [dir]    validate a course package, or an extensions folder (extensions/<course-id>/),
                    which is also checked against its course package (--package <dir> to point at it)`;

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "up":
      return up();
    case "down":
      return down();
    case "doctor":
      return doctor(rest);
    case "new-id":
      return newId(rest);
    case "translate":
      return translate(rest);
    case "validate":
      return validate(rest);
    default:
      console.log(USAGE);
      return cmd === undefined || cmd === "--help" || cmd === "-h" ? 0 : 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error((e as Error).message);
    process.exit(1);
  },
);
