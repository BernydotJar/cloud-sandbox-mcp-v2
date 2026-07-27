FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    HOME=/home/agent \
    CI=true \
    PATH=/home/agent/.local/bin:/root/.local/bin:/usr/local/bin:${PATH} \
    UV_CACHE_DIR=/home/agent/.cache/uv \
    PIP_CACHE_DIR=/home/agent/.cache/pip \
    NPM_CONFIG_CACHE=/home/agent/.cache/npm \
    PLAYWRIGHT_BROWSERS_PATH=/home/agent/.cache/ms-playwright

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      apt-transport-https bash build-essential ca-certificates chromium curl \
      docker.io docker-compose git gh jq less lsof make openssh-client \
      # docker.io docker-compose-plugin git gh jq less lsof make openssh-client \
      postgresql-client python3 python3-dev python3-pip python3-venv \
      redis-tools ripgrep shellcheck sudo unzip wget zip \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh \
    && git config --system --add safe.directory /workspace \
    && mkdir -p /workspace /home/agent /var/lib/docker \
    && chmod 1777 /home/agent

# Install the current official AWS CLI v2.
RUN set -eux; \
    arch="$(uname -m)"; \
    case "$arch" in \
      aarch64|arm64) aws_arch="aarch64" ;; \
      x86_64|amd64) aws_arch="x86_64" ;; \
      *) echo "Unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL \
      "https://awscli.amazonaws.com/awscli-exe-linux-${aws_arch}.zip" \
      -o /tmp/awscliv2.zip; \
    cd /tmp; \
    unzip -q awscliv2.zip; \
    ./aws/install \
      --bin-dir /usr/local/bin \
      --install-dir /usr/local/aws-cli; \
    rm -rf /tmp/aws /tmp/awscliv2.zip; \
    /usr/local/bin/aws --version

COPY docker/workstation-entrypoint.sh /usr/local/bin/cloud-sandbox-workstation
RUN chmod +x /usr/local/bin/cloud-sandbox-workstation

WORKDIR /workspace
USER root
ENTRYPOINT ["/usr/local/bin/cloud-sandbox-workstation"]
