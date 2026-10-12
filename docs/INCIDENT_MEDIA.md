# Incident report photos and videos

## Upload limits

- **Per report:** up to 5 files.
- **Photos:** JPEG, PNG or WebP, up to 10 MB each.
- **Videos:** MP4, MOV, 3GP or WebM, up to 50 MB each. The app limits recordings to 60 seconds.

## How it works

1. The app creates the report with `POST /api/v1/incidents`. The response includes an `uploadToken`, which is valid for 1 hour and only for that report.
2. The app sends each file with `POST /api/v1/incidents/:id/media`, as `multipart/form-data`, with the token in the `X-Upload-Token` header. The report stays anonymous because no login is involved.
3. Admins can add files to the same endpoint using their normal login.
4. Admins view files through `GET /api/v1/incidents/:id/media` and `GET /api/v1/incidents/media/:mediaId/raw`, and delete them with `DELETE /api/v1/incidents/media/:mediaId`. There is no public URL for any file.

## Privacy

| What | How |
|---|---|
| Location in photos (EXIF) | Removed before storing: JPEG APP1 and APP13 segments, PNG eXIf and text chunks, and WebP EXIF/XMP chunks |
| Location in videos | ISO-6709 position strings (Android `©xyz`, Apple `…location.ISO6709`) are overwritten with zeros |
| File names | Replaced with `incident-<id>-<n>.<ext>` |
| File type | Checked against the file's first bytes; HEIC, SVG and other types are refused |

The picker in the app also asks for files without EXIF (`exif: false`), and on iOS for a compatible format (JPEG / H.264).

**Limitation:** a video can still contain location in unusual formats, such as GoPro GPMF telemetry tracks. Moderators should treat attachments as sensitive.

## Deploying

- Run `npx prisma migrate deploy`. This applies migration `20261012010000_incident_media`, which creates the `incident_media` table. **Never use `db push`.**
- The production nginx upload limit is now `client_max_body_size 55m`.
- The mobile app needs a new native build, because `app.json` gained the `expo-image-picker` permission texts. iOS needs the photo-library text.

## Analytics heatmap

The heatmap uses free map tiles that need no API key (OpenStreetMap, CARTO, Esri). If a provider fails, it switches to the next one automatically. A Google Maps key is not needed.
