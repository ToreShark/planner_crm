FROM node:20-alpine

RUN apk add --no-cache tzdata
ENV TZ=Asia/Almaty

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN rm -f tsconfig.tsbuildinfo && npm run build

EXPOSE 3000

CMD ["node", "dist/main.js"]
