#!/bin/bash
# Script to build and start the guest sandbox container securely.

# Exit on error
set -e

CONTAINER_NAME="guest-sandbox"
IMAGE_NAME="safe-sandbox"
VNC_PORT=5900

echo "Checking if Docker is installed..."
if ! command -v docker &> /dev/null; then
    echo "ERROR: Docker is not installed or not in PATH. Please install Docker first."
    exit 1
fi

# Stop and remove any existing guest-sandbox container
if docker ps -a --format '{{.Names}}' | grep -Eq "^${CONTAINER_NAME}$"; then
    echo "Stopping existing sandbox container..."
    docker stop "$CONTAINER_NAME" || true
    docker rm "$CONTAINER_NAME" || true
fi

# Get the script directory
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

echo "Building secure sandbox image..."
docker build -t "$IMAGE_NAME" "$DIR"

echo "Starting sandbox container with strict safety controls..."
# Run container with:
# -d: background mode
# --rm: automatically clean up files/container on exit
# -p 127.0.0.1:5900:5900: expose VNC strictly on localhost (127.0.0.1) so outside network cannot access it
# --memory=2g: limit memory usage to 2GB to prevent host system exhaustion
# --cpus=2.0: limit CPU usage to 2 cores
# --security-opt=no-new-privileges: prevent the guest user from gaining new privileges
# --cap-drop=ALL: drop all capabilities, container does not need host system admin access
docker run -d \
    --name "$CONTAINER_NAME" \
    --rm \
    -p 127.0.0.1:$VNC_PORT:5900 \
    --memory="2g" \
    --cpus="2.0" \
    --security-opt=no-new-privileges \
    --cap-drop=ALL \
    "$IMAGE_NAME"

echo "Sandbox started successfully."
echo "VNC exposed on 127.0.0.1:$VNC_PORT (Localhost ONLY)."
echo "You can check status using: docker ps -f name=$CONTAINER_NAME"
