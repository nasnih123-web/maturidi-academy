# Custom ClamAV image for the Maturidi Academy Railway deployment.
#
# Same official image, plus a custom clamd.conf (copied to both config
# locations used across image versions) so that:
#   - clamd logs to stdout/stderr (visible in Railway deployment logs),
#   - TCP listening on 3310 is explicit (required by the API service),
#   - stream/file size limits are raised above the stock defaults.
#
# Background: with the stock image on Railway, clamd never produced a
# socket and failed silently at every 30-minute entrypoint cycle
# ("Failed to start clamd", no clamd output anywhere in the logs), so
# its real error was invisible. Removing LogFile makes a foreground
# clamd log to stdout/stderr, which Railway captures.
FROM clamav/clamav:latest
USER root
COPY clamd.conf /clamav/config/clamd.conf
COPY clamd.conf /etc/clamav/clamd.conf
