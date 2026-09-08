FROM node:22.13-alpine@sha256:1322b1e3975e50d4841db1f23f536a8e72249e16a89e1dbbf16953afaa816d41 AS build
WORKDIR /workspace
# Two independent bugs stacked here, both confirmed live:
#  1. package-lock.json's resolved URLs point at a private internal
#     registry mirror (npm.mirrors.msh.team) from wherever this repo's
#     real CI runs - unreachable here (getaddrinfo ENOTFOUND). `npm
#     install` re-resolves against the public registry instead of the
#     lockfile's exact recorded host, unlike `npm ci`.
#  2. Independently, the bundled npm 10.9.2 hits its own "Exit handler
#     never called!" bug on this Node/Alpine combination, regardless of
#     registry - still reproduced even once (1) was fixed. Needs both
#     fixed together.
RUN npm install -g npm@11
COPY package.json package-lock.json ./
# --registry only changes where NEW resolutions come from; npm still
# reuses each package's already-pinned "resolved" URL from the lockfile
# when its version/integrity still match, which is exactly what still
# pointed several packages (e.g. why-is-node-running) at the private
# mirror even with the flag set. Dropping the lockfile forces a fully
# fresh resolution against the public registry for every package.
RUN rm -f package-lock.json && npm install --ignore-scripts --registry=https://registry.npmjs.org/
COPY . ./
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.31.4-alpine3.24@sha256:b18de2210c3255d942d7067f99429ec78a62ce957a14d6a11baa1b684f492dff
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/dist /usr/share/nginx/html
VOLUME ["/tmp", "/var/cache/nginx", "/var/run"]
EXPOSE 8080
USER 101
