FROM node:20-alpine AS builder

WORKDIR /app

# Install OpenSSL (required for Prisma on Alpine)
RUN apk add --no-cache openssl

# Copy root package.json and workspace package.json files
COPY package.json package-lock.json* ./
COPY apps/admin-portal/package.json ./apps/admin-portal/
COPY apps/police-portal/package.json ./apps/police-portal/
COPY services/api/package.json ./services/api/
COPY packages/shared/package.json ./packages/shared/

# Install all dependencies
RUN npm install

# Copy all source files
COPY . .

# Build the shared package first — the API imports its compiled output.
RUN npm --workspace=packages/shared run build

# Generate Prisma Client
WORKDIR /app/services/api
RUN npm run prisma:generate

# Build the API
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache openssl

# Copy node_modules and built assets
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/services/api/node_modules ./services/api/node_modules
COPY --from=builder /app/services/api/dist ./services/api/dist
COPY --from=builder /app/services/api/package.json ./services/api/
COPY --from=builder /app/services/api/prisma ./services/api/prisma

WORKDIR /app/services/api

EXPOSE 3001

CMD ["npm", "run", "start"]
