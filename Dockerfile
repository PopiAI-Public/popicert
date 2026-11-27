# syntax=docker/dockerfile:1
# Imagen de PopiCert: un solo contenedor HTTP en el puerto 3000.
# Al arrancar aplica las migraciones pendientes y después sirve la app.

FROM node:22-alpine AS base
# OpenSSL lo necesita el motor de migraciones de Prisma.
RUN apk add --no-cache openssl
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Dependencias completas, para compilar.
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Solo dependencias de producción, para la imagen final.
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npx next build

FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --chown=node:node package.json next.config.ts prisma.config.ts ./
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && exec node node_modules/next/dist/bin/next start"]
