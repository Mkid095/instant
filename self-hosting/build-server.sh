#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SERVER_DIR="$PROJECT_ROOT/server"

IMAGE_TAG="${1:-localhost:5000/instant-server:custom}"

echo "Building custom InstantDB server image..."
echo "  Source: $SERVER_DIR"
echo "  Tag: $IMAGE_TAG"

cd "$SERVER_DIR"

docker build \
  -f Dockerfile.self-hosted \
  -t "$IMAGE_TAG" \
  .

echo ""
echo "Build complete: $IMAGE_TAG"
echo ""
echo "To use this image, set INSTANT_SERVER_IMAGE in your .env:"
echo "  INSTANT_SERVER_IMAGE=$IMAGE_TAG"
echo ""
echo "Then deploy with:"
echo "  docker compose -f docker-compose.with-caddy.yml up -d"
