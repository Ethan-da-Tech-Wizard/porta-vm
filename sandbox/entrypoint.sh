#!/bin/bash
set -e

# Cleanup any previous locks
rm -f /tmp/.X1-lock

# Start Xvfb (Virtual Framebuffer)
echo "Starting Xvfb on display :1..."
Xvfb :1 -screen 0 "${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH}" &
Xvfb_pid=$!

# Wait for Xvfb to start
sleep 1

# Start Fluxbox Window Manager
echo "Starting Fluxbox window manager..."
fluxbox &
fluxbox_pid=$!

# Start Firefox, Mousepad text editor, and xterm inside the virtual display
echo "Starting applications..."
firefox-esr &
firefox_pid=$!

# Launch Mousepad in the background so they can type immediately
mousepad &
mousepad_pid=$!

# Start xterm placed at the top-left
xterm -geometry 80x24+0+0 -title "Terminal" &
xterm_pid=$!

# Start x11vnc server attached to display :1
# -forever: keep server alive after client disconnects
# -shared: allow multiple clients (if host also wants to peek, but only guest controls)
# -nopw: no password (security is handled by binding container port only to localhost)
# -listen 0.0.0.0: listen on all interfaces inside the container (so host proxy can connect)
echo "Starting x11vnc..."
x11vnc -display :1 -nopw -listen 0.0.0.0 -forever -shared

# Wait for the main Xvfb process to keep the container running
wait $Xvfb_pid
