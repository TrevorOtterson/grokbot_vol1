FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
# Placeholder so `prisma generate` can run at image build. Fly runtime
# overwrites this with the attached Postgres URL. Never commit real secrets.
ENV DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/receivekit?schema=public"

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev && npm cache clean --force

COPY . .

RUN npm run build

CMD ["npm", "run", "docker-start"]
