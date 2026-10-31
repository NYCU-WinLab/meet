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
3. `egress-upload` waits for the `EG_*.json` manifest, sends the MP4 to transcribe, and uploads it to Nextcloud under `meet/<YYYY-MM>/<stem>/`.
4. Parts of one booking wait in `/var/lib/egress-hold/<booking>/` until 1 hour after the booking ends, then ffmpeg joins them.
5. `egress-transcribe` puts the transcript, subtitles and notes next to the MP4 (`<stem>.txt`, `.srt`, `.notes.md`, `.notes.json`), then sends the hand-off to winlab-helper's trigger.

## Empty stretches cut

Before a recording ships or is held, `egress-upload` asks meet's `recording_gaps` (service key `egress` in meet's `SERVICE_KEYS`, `MEET_SERVICE_KEY` here) when no member was in the room, by egress id and in seconds of the file itself, and cuts every stretch of 10 s or longer, keeping 2 s on each side, with a stream copy. The transcript, subtitles and notes are made from the cut file, so their times match it.

- Nothing to cut, the API unreachable, a plan that keeps under 5 s, or an output whose length is off: the recording ships whole.
- meet has not heard the recording end yet: the file waits for the next run, up to 10 minutes, then ships whole.
- `<file>.trimmed` is written before the cut file replaces the original, so a retry never cuts twice.

## Hand-off v2

The helper gets a read-only, password share of the recording's folder for 6 days and one signed trigger. It fetches the MP4 and each sidecar beside it, and checks them against the signed hashes.

| Field | Value |
| --- | --- |
| `MEET_ROOM`, `MEET_EGRESS_ID` | The room name and the egress id |
| `DL_URL` | `https://<share>:<password>@nextcloud.winlab.tw/public.php/webdav/<stem>.mp4` |
| `NC_SIZE`, `NC_SHA256` | The MP4 as uploaded (with the subtitle track) |
| `SUBJECT`, `PERSON`, `GROUP_NAME`, `BOOKING_REQUEST_ID` | From the file name |
| `START_TIME`, `END_TIME` | From the egress manifest, UTC `YYYY-MM-DDTHH:MM:SSZ` |
| `RELAY_VERSION` | `2` |
| `TX_JOB_ID` | The transcribe job |
| `TRANSCRIPT_STATUS` | `ok`, `empty` (no speech) or `failed` (the helper runs its own ASR) |
| `TRANSCRIPT_SHA256`, `SUBTITLE_SHA256` | sha256 of `.txt` and `.srt`, or empty |
| `NOTES_STATUS` | `ok`, `timeout` (none after 30 min), `failed` or `none` |
| `NOTES_SHA256`, `NOTES_JSON_SHA256` | sha256 of `.notes.md` and `.notes.json`, or empty |
| `NC_NAME` | `<stem>.mp4`, not signed |
| `RELAY_SIG` | HMAC-SHA256 with `HELPER_RELAY_SECRET` over `KEY=value` lines of the 19 fields above in this order, no trailing newline |

The statuses and hashes are written to the `.pending` file before the trigger, so a retry sends the same signed values. A `.pending` file from before folders (no `dir=1`) keeps the v1 hand-off: a share of the MP4 alone and the 11 v1 fields, signed the same way. Notes are asked as `lab_meeting` when the group is `lab-meeting`, else `general`.

Rollout order: winlab-helper "Relay v2" merged, its egress token and `HELPER_RELAY_SECRET` set (winlab-helper#10, #11), then install these scripts and add the secret to `/etc/egress-upload.env`.

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
