FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl file git pkg-config \
    libwebkit2gtk-4.1-dev librsvg2-dev libxdo-dev \
    libssl-dev libayatana-appindicator3-dev && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"
RUN corepack enable
WORKDIR /workspace
COPY . .
RUN corepack pnpm install --frozen-lockfile
RUN corepack pnpm build:web
RUN corepack pnpm --filter @paperwitha/desktop build:native
