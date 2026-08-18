FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build
RUN chmod +x ./scripts/docker-entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3000

# node:20-slim defaults to UTC. That put two different time bases in one
# database: CSV imports convert wall-clock times through
# CSV_IMPORT_TIMEZONE (America/Vancouver), while offline orders created
# in the admin UI go through `new Date("2026-04-22T09:00")`, which the
# spec parses as *server local* time. A Turo trip and a walk-in rental
# both entered as "9am" were stored 7 hours apart — breaking conflict
# detection in both directions, and making the server-rendered orders
# list disagree with the client-rendered detail modal about the same row.
#
# Aligning the container clock with the fleet's operating timezone makes
# the two paths agree. Override TZ (and CSV_IMPORT_TIMEZONE with it) if
# the fleet operates elsewhere.
ENV TZ=America/Vancouver

EXPOSE 3000

CMD ["./scripts/docker-entrypoint.sh"]
