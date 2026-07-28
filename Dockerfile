# Single-service image: Express serves BOTH the API and the vanilla client, mounted under
# BASE_PATH (default /workouts) so it can live behind a Cloudflare route
# (flywren-technologies.com/workouts). The client is no-build — `npm run build` just stages the
# client files into server/public; BASE_PATH is injected at serve time via /base.js.
FROM node:22-slim
ARG BASE_PATH=/workouts
ENV NODE_ENV=production
ENV BASE_PATH=$BASE_PATH
WORKDIR /app

# Install server deps first for layer caching.
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# App source (server + the root client files build-client stages into server/public).
COPY . .
RUN cd server && npm run build

EXPOSE 4000
WORKDIR /app/server
CMD ["node", "src/index.js"]
