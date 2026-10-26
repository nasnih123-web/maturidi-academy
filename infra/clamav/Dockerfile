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
#
# Build-context note: Railway builds this service from the repository
# root (no root directory is set), so COPY source paths MUST be
# relative to the repo root, not to this Dockerfile's directory.
# A bare "COPY clamd.conf ..." fails the build because there is no
# clamd.conf at the repo root.
FROM clamav/clamav:latest
USER root
COPY infra/clamav/clamd.conf /clamav/config/clamd.conf
COPY infra/clamav/clamd.conf /etc/clamav/clamd.conf
