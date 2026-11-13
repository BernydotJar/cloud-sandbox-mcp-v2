# Operator-reviewed image upgrade; does not run in the agent workstation.
# Supply the EXACT existing controller image digest or immutable local image ID.
# The existing Compose /app/dist bind mount continues to supply the customized code.
ARG EXISTING_CONTROLLER_IMAGE
FROM ${EXISTING_CONTROLLER_IMAGE}
USER root
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force
# Existing entrypoint/CMD, filesystem, Docker client and runtime configuration inherit
# from the original controller image. Do not replace the workstation image or mounts.
