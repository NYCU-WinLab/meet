# Egress hosts

Files for the 2 LiveKit Egress VMs (`egress01`, `egress02`). Both run the same copy.

## Layout

| Repo path | Host path |
| --- | --- |
| `compose.yaml` | `~/egress/compose.yaml` |
| `config.example.yaml` | `~/egress/config.yaml` (mode 644, real LiveKit key) |
| `bin/egress-upload` | `/usr/local/bin/egress-upload` |
| `bin/egress-transcribe` | `/usr/local/bin/egress-transcribe` |
| `systemd/egress-upload.service` | `/etc/systemd/system/egress-upload.service` |
| `systemd/egress-upload.timer` | `/etc/systemd/system/egress-upload.timer` |
| `egress-upload.env.example` | `/etc/egress-upload.env` (mode 600, real values) |

## What runs

1. The `egress` container records rooms into `~/egress/out/recordings/` (owned by uid 1001).
2. The timer runs the service every minute.
3. `egress-upload` waits for the `EG_*.json` manifest, sends the MP4 to transcribe, and uploads it to Nextcloud under `meet/<YYYY-MM>/`.
4. Parts of one booking wait in `/var/lib/egress-hold/<booking>/` until 1 hour after the booking ends, then ffmpeg joins them.
5. `egress-transcribe` puts the transcript, subtitles and notes next to the MP4, then sends the hand-off to the GitLab trigger.

## Install or update

```sh
for h in egress01 egress02; do
  scp bin/egress-upload bin/egress-transcribe $h.winfra:/tmp/
  ssh $h.winfra 'sudo install -m 755 /tmp/egress-upload /tmp/egress-transcribe /usr/local/bin/'
done
```

For a new host, also copy `compose.yaml`, write `config.yaml` and `/etc/egress-upload.env`, install the units, then run:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now egress-upload.timer
cd ~/egress && docker compose up -d
```
