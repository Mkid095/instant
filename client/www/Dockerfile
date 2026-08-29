FROM node:22-alpine
RUN apk add --no-cache curl

WORKDIR /app

COPY .next/standalone ./
COPY .next/static ./www/.next/static
COPY public ./www/public

ENV NODE_ENV=production
ENV NEXT_PUBLIC_SELF_HOSTED=true
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

CMD ["node","www/server.js"]
