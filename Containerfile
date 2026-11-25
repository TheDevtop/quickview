FROM docker.io/library/node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY main.js ./
COPY models models
COPY controllers controllers
COPY views views

ENV NODE_ENV=production \
    PORT=3000 \
    QUICKTABLE_URL=http://localhost:16000
EXPOSE 3000
USER node
CMD ["node", "main.js"]

LABEL org.opencontainers.image.source=https://github.com/TheDevtop/quickview
LABEL org.opencontainers.image.licenses=MIT
