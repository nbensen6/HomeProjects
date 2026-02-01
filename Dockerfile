FROM node:18-bullseye-slim

# Install build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Create data directory for SQLite
RUN mkdir -p /data

ENV DATA_DIR=/data

EXPOSE 3000

CMD ["npm", "start"]
