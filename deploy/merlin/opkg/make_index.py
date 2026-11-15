#!/usr/bin/env python3
"""Generate an opkg Packages index (and Packages.gz) from .ipk files.

Entware/opkg reads a feed as a directory containing Packages.gz and the .ipk
files it names. This reads each .ipk's control file and adds the fields the
index needs (Filename, Size, MD5Sum, SHA256sum).

    make_index.py <feeddir>
"""
import gzip
import hashlib
import io
import os
import sys
import tarfile


def ar_members(path):
    with open(path, "rb") as f:
        if f.read(8) != b"!<arch>\n":
            raise ValueError(f"{path}: not an ar archive")
        while True:
            header = f.read(60)
            if len(header) < 60:
                return
            name = header[0:16].decode("ascii", "replace").strip().rstrip("/")
            try:
                size = int(header[48:58].decode("ascii").strip())
            except ValueError:
                raise ValueError(f"{path}: bad ar header")
            data = f.read(size)
            if size % 2:
                f.read(1)
            yield name, data


def control_text(path):
    for name, data in ar_members(path):
        if not name.startswith("control.tar"):
            continue
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:*") as tar:
            for member in tar.getmembers():
                if member.name.lstrip("./") == "control":
                    return tar.extractfile(member).read().decode("utf-8")
    raise ValueError(f"{path}: no control file")


def parse_control(text):
    fields = {}
    key = None
    for line in text.splitlines():
        if line.startswith(" ") and key:
            fields[key] += "\n" + line
        elif ":" in line:
            key, value = line.split(":", 1)
            key = key.strip()
            fields[key] = value.strip()
    return fields


ORDER = [
    "Package",
    "Version",
    "Depends",
    "Provides",
    "Section",
    "Priority",
    "Architecture",
    "Installed-Size",
    "Filename",
    "Size",
    "MD5Sum",
    "SHA256sum",
    "Description",
]


def main(feeddir):
    packages = []
    for name in sorted(os.listdir(feeddir)):
        if not name.endswith(".ipk"):
            continue
        path = os.path.join(feeddir, name)
        fields = parse_control(control_text(path))
        fields["Filename"] = name
        fields["Size"] = str(os.path.getsize(path))
        with open(path, "rb") as f:
            blob = f.read()
        fields["MD5Sum"] = hashlib.md5(blob).hexdigest()
        fields["SHA256sum"] = hashlib.sha256(blob).hexdigest()

        lines = []
        for key in ORDER:
            if key not in fields:
                continue
            value = fields[key]
            if key == "Description":
                # keep the continuation lines (they already start with a space)
                lines.append(f"{key}: {value}")
            else:
                lines.append(f"{key}: {value}")
        packages.append("\n".join(lines) + "\n")

    index = "\n".join(packages)
    with open(os.path.join(feeddir, "Packages"), "w", encoding="utf-8") as f:
        f.write(index)
    with open(os.path.join(feeddir, "Packages.gz"), "wb") as f:
        f.write(gzip.compress(index.encode("utf-8"), compresslevel=9, mtime=0))
    print(f"indexed {len(packages)} package(s) in {feeddir}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: make_index.py <feeddir>")
    main(sys.argv[1])
