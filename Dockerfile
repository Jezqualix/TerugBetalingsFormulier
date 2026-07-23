# syntax=docker/dockerfile:1
FROM node:22-alpine

RUN apk add --no-cache tzdata
ENV TZ=Europe/Brussels

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public
COPY migrations ./migrations

# Non-root: web-service, dus wél een user.
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node

ENV NODE_ENV=production
ENV PORT=3004

EXPOSE 3004

CMD ["node", "src/server.js"]
