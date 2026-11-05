FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8765 EVENTFLOW_DATA=/data
COPY --chown=10001:10001 . /app
RUN npm ci --omit=dev --no-audit --no-fund && mkdir -p /data && chown -R 10001:10001 /data /app
USER 10001:10001
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8765/api/health || exit 1
CMD ["node","server.js"]
