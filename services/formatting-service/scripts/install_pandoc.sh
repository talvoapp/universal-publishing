#!/usr/bin/env bash
# ============================================================
# Install Pandoc (only needed for local dev outside Docker)
# ============================================================
set -euo pipefail

PANDOC_VERSION="${PANDOC_VERSION:-3.1.11}"

if command -v pandoc >/dev/null 2>&1; then
  echo "✓ pandoc already installed: $(pandoc --version | head -1)"
  exit 0
fi

OS="$(uname -s)"
ARCH="$(uname -m)"

echo "Installing pandoc ${PANDOC_VERSION} for ${OS}/${ARCH}..."

case "${OS}" in
  Darwin)
    if command -v brew >/dev/null 2>&1; then
      brew install pandoc
    else
      echo "✗ Homebrew required on macOS. Install from https://brew.sh"
      exit 1
    fi
    ;;
  Linux)
    if command -v apt-get >/dev/null 2>&1; then
      sudo apt-get update && sudo apt-get install -y pandoc
    elif command -v dnf >/dev/null 2>&1; then
      sudo dnf install -y pandoc
    else
      # Fallback: download the static binary
      DEB_ARCH="amd64"
      [ "${ARCH}" = "aarch64" ] && DEB_ARCH="arm64"
      URL="https://github.com/jgm/pandoc/releases/download/${PANDOC_VERSION}/pandoc-${PANDOC_VERSION}-linux-${DEB_ARCH}.tar.gz"
      TMP="$(mktemp -d)"
      curl -sSL "${URL}" -o "${TMP}/pandoc.tar.gz"
      tar -xzf "${TMP}/pandoc.tar.gz" -C "${TMP}"
      sudo mv "${TMP}/pandoc-${PANDOC_VERSION}/bin/pandoc" /usr/local/bin/pandoc
      rm -rf "${TMP}"
    fi
    ;;
  *)
    echo "✗ Unsupported OS: ${OS}"
    exit 1
    ;;
esac

echo "✓ pandoc installed: $(pandoc --version | head -1)"
echo ""
echo "Also install WeasyPrint system deps:"
echo "  macOS:  brew install pango cairo gdk-pixbuf libffi"
echo "  Linux:  sudo apt-get install libpango-1.0-0 libpangoft2-1.0-0 libcairo2 libgdk-pixbuf-2.0-0"