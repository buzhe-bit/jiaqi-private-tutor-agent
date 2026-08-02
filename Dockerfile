FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY src ./src
COPY skills/philosophy-answer-coach ./skills/philosophy-answer-coach

ENV NODE_ENV=production
ENV PORT=80
EXPOSE 80

CMD ["node", "src/server.mjs"]
