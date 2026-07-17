# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Vite bakes these in at BUILD time — provide as build args.
ARG VITE_API_URL
ARG VITE_WS_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL

# Copy root + workspace manifests first for better layer caching
COPY package.json package-lock.json* ./
COPY apps/admin-portal/package.json ./apps/admin-portal/
COPY apps/police-portal/package.json ./apps/police-portal/
COPY services/api/package.json ./services/api/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies (workspaces)
RUN npm install

# Copy all source files
COPY . .

# Build shared first, then the police portal
RUN npm --workspace=packages/shared run build
RUN npm --workspace=apps/police-portal run build

# Production stage — static files served by nginx
FROM nginx:alpine

COPY apps/police-portal/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/police-portal/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
