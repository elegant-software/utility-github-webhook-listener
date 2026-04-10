# Stage 1: Install dependencies
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Stage 2: Production image
FROM node:20-alpine

RUN apk add --no-cache github-cli

WORKDIR /app

COPY package*.json ./
COPY --from=builder /app /app

EXPOSE 3000
ENV NODE_ENV=production
CMD ["npm", "start"]
