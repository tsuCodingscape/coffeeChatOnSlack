# Use official Node.js LTS image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files first (better Docker layer caching)
COPY package*.json ./

# Install all dependencies including devDependencies for TypeScript build
RUN npm ci

# Copy the rest of the source code
COPY . .

# Build TypeScript to JavaScript
RUN npm run build

# Remove devDependencies after build to keep image small
RUN npm prune --production

# Expose the port the app runs on
EXPOSE 3000

# Start the compiled app
CMD ["node", "dist/index.js"]