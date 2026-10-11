# Browser Runtime V2 — controlled MCP image promotion

## Scope and immutable image identifiers

Use a single Compose service image override to promote only the existing cloud-sandbox-mcp controller. Preserve its customized code bind mount, network, environment, volumes, other services and dev-main.

Previous image:
sha256:55be5b2aa44d164a777b87f55d46f351d56fe0463a6527f6efad96918567fdcb

New local image:
sha256:b7d9847967ddc0d08ad665b68f8309b22b743857f176741791efbb1925d2f201

New local tag:
cloud-sandbox-mcp:deps-v2-55be5b2aa44d-d1b4b0f9afe9

Runtime release provenance commit:
f95ffeb3e76b41be38696bf159ab71b8acb49b4f

## Mac operator procedure

First run a read-only preflight:

    node "$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/runtime-v2-f95ffeb/operator-image-promotion/promote-on-mac.mjs" --inspect

Only if it reports PREFLIGHT_PASS and COMPOSE_DIFFERENCE=image-only on services.mcp, run:

    node "$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/runtime-v2-f95ffeb/operator-image-promotion/promote-on-mac.mjs" --promote

Confirm once with PROMOTE_MCP_IMAGE. This is a deployment authorization, not a separate approval for every click.

The script verifies the exact local image IDs, the original Compose project, a healthy running controller, a non-active delegated Computer Use session, and the original dev-main container identity.

It uses a temporary read-only Compose override through standard input for preflight, checks that the entire rendered configuration is identical except services.mcp.image, then adds a persistent private override file under the existing Cloud Sandbox shared-auth/deployment directory.

Only the mcp service is recreated, using --no-deps, --no-build, --pull never, --force-recreate. The script verifies health, the pinned 8 dependencies, all 23 existing MCP tools including project_register, original mounts/network/ports/env/restart policy, and unchanged dev-main. It records a private rollback receipt.

Expected result: MCP_IMAGE_PROMOTION_PASS. Some MCP tool requests may temporarily be unavailable while the controller restarts.

## Next phase

After success, run the read-only Browser Runtime V2 preflight:

    node "$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/runtime-v2-f95ffeb/install.mjs" --inspect

The dependency image gate should now pass. The installation of Runtime V2 source code and CDP provider pairing remain separate verifications. Last known persistent providers: NONE. Do not claim enterprise-ready CDP control yet.

## Rollback and operational safety

Before Runtime V2 code has been installed, rollback the image with:

    node "$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/runtime-v2-f95ffeb/operator-image-promotion/promote-on-mac.mjs" --rollback

Approve with ROLLBACK_MCP_IMAGE. The old image and the 23-tool registry are restored and checked.

If Runtime V2 code has already been installed, revert the Runtime V2 code and Mac host bridge from the V2 installer's backup FIRST. Only then use image-only rollback. The promotion tool rejects incompatible rollback attempts with ROLLBACK_V2_CODE_FIRST_THEN_IMAGE.

Do not delete the permanent Compose override if the running container's Compose metadata lists it. Do not run Docker prune or recreate dev-main.

## QA

The isolated tests use a fake Docker CLI, fake Compose metadata, fake bridge and fake user home. They verify read-only preflight, rejection without operator authorization, active task refusal, drift refusal, exact one-image promotion, 23 tool-registry verification, rollback-order enforcement, explicit rollback, and injected failure recovery. They do not exercise the real Docker Desktop daemon.

    node /shared-auth/deployment/handoff/cloud-sandbox-computer-use/runtime-v2-f95ffeb/operator-image-promotion/test-integration-sim.mjs

The real Mac promotion has not been run yet. It is not complete until the operator reports MCP_IMAGE_PROMOTION_PASS.
