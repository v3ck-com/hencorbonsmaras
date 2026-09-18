# Build with repository root as context: docker build -f auction/Dockerfile .
FROM node:24.12.0-alpine AS frontend
WORKDIR /src
COPY auction/package*.json ./
RUN npm ci
COPY auction/web ./web
RUN npm run build

FROM golang:1.25.6-alpine AS backend
WORKDIR /src
COPY auction/go.mod auction/go.sum ./
RUN go mod download
COPY auction/ ./
COPY --from=frontend /src/web/static/app.js ./web/static/app.js
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /auction ./cmd/auction

FROM alpine:3.23
RUN apk add --no-cache ca-certificates && addgroup -S auction && adduser -S -G auction auction
WORKDIR /app
COPY --from=backend /auction /app/auction
COPY assets/logo.png /app/catalogue/logo.png
COPY assets/bull-images /app/catalogue/bull-images
COPY assets/katalogus-tables /app/catalogue/katalogus-tables
USER auction
ENV LISTEN_ADDR=:8080 ASSETS_DIR=/app/catalogue
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/app/auction"]
