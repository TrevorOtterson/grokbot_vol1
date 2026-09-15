FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
# Do not set HOST at image build time: vite.config.ts may copy HOST into
# SHOPIFY_APP_URL and `new URL("0.0.0.0")` fails. Bind via PORT at runtime.
# Placeholder so `prisma generate` can run at image build. Fly runtime
# overwrites this with the attached Postgres URL. Never commit real secrets.
ENV DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/receivekit?schema=public"

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev && npm cache clean --force

COPY . .

RUN npm run build

CMD ["npm", "run", "docker-start"]
