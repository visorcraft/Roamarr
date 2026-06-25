# Podman

Roamarr's existing `Dockerfile` works with Podman. These files provide a basic
rootless Podman setup with a named volume for `/data`.

## One-off container

Run these commands from the repository root:

```sh
podman build -t localhost/roamarr:latest -f Dockerfile .
podman volume create roamarr-data
cp deploy/podman/roamarr.env.example .podman.env
$EDITOR .podman.env

podman run --replace -d \
  --name roamarr \
  --publish 3000:3000 \
  --volume roamarr-data:/data \
  --env-file .podman.env \
  localhost/roamarr:latest
```

Open `http://localhost:3000` and complete first-run setup.

## Quadlet systemd service

For a persistent rootless service:

```sh
mkdir -p ~/.config/containers/systemd
cp deploy/podman/roamarr.container ~/.config/containers/systemd/
cp deploy/podman/roamarr.env.example ~/.config/containers/systemd/roamarr.env
$EDITOR ~/.config/containers/systemd/roamarr.env

podman build -t localhost/roamarr:latest -f Dockerfile .
systemctl --user daemon-reload
systemctl --user enable --now roamarr.service
```

Useful commands:

```sh
systemctl --user status roamarr.service
journalctl --user -u roamarr.service -f
systemctl --user restart roamarr.service
```

To keep the user service running after logout on a server:

```sh
loginctl enable-linger "$USER"
```
