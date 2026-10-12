FROM debian:bookworm-slim

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install Xvfb, Fluxbox, x11vnc, Firefox-ESR, terminal emulator, and mousepad text editor
RUN apt-get update && apt-get install -y \
    xvfb \
    fluxbox \
    x11vnc \
    xterm \
    firefox-esr \
    mousepad \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Create a dedicated guest user for security isolation
RUN useradd -m -u 1000 guestuser && \
    mkdir -p /home/guestuser/.fluxbox && \
    chown -R guestuser:guestuser /home/guestuser

USER guestuser
WORKDIR /home/guestuser

# Environment variables for screen configurations
ENV DISPLAY=:1
ENV SCREEN_WIDTH=1280
ENV SCREEN_HEIGHT=720
ENV SCREEN_DEPTH=24

# Copy and configure entrypoint script
COPY --chown=guestuser:guestuser entrypoint.sh /home/guestuser/entrypoint.sh
RUN chmod +x /home/guestuser/entrypoint.sh

# Expose VNC port inside container networking
EXPOSE 5900

CMD ["/home/guestuser/entrypoint.sh"]
