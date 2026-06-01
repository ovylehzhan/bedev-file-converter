FROM node:20-alpine

WORKDIR /app

# Copy package files first — Docker caches this layer
# So npm install only re-runs when dependencies change
COPY package*.json ./
RUN npm install

# Copy source code (changes more often than dependencies)
COPY . .
RUN npm run build

# Create uploads directory
RUN mkdir -p /app/uploads

CMD ["npm", "run", "start:prod"]
