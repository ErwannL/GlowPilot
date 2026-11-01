# GlowPilot Hub image. Build context: packages/hub after `npm run build` and copying the web UI to web/.
FROM node:22-slim
WORKDIR /app
RUN npm init -y >/dev/null && npm install --omit=dev node-ble@1.13.0 ws@8 >/dev/null 2>&1 && npm cache clean --force
COPY dist/hub.cjs ./hub.cjs
COPY web ./web
ENV GLOWPILOT_DATA=/data GLOWPILOT_WEB=/app/web GLOWPILOT_PORT=47821 TZ=Europe/Paris
VOLUME /data
CMD ["node", "hub.cjs"]
