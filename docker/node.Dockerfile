# One image for install, api and web. git is for adding a course from a repository (the api shells out to it);
# python3, make and g++ are the fallback when better-sqlite3 has no prebuilt binary for this platform.
FROM node:24-slim
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends git ca-certificates python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
