# Base Image setup
FROM node:20-alpine AS base
WORKDIR /app

# Dependencies stage
FROM base AS deps
COPY package.json package-lock.json ./
# Install ALL dependencies including devDependencies to build TypeScript
RUN npm ci

# Build stage
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Run TypeScript compiler
RUN npm run build

# Production stage
FROM base AS runner
# Set node env to production
ENV NODE_ENV=production

# Copy package.json and only install production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled JS files from builder
COPY --from=builder /app/dist ./dist

# Optional: Add user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 8080

# Run the app
CMD ["npm", "start"]
