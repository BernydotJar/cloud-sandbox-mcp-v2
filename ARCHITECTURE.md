# Architecture

```text
ChatGPT
  -> HTTPS / Streamable HTTP MCP
  -> MCP controller container
      -> host Docker API
      -> one privileged workstation container per workspace
          -> persistent /workspace
          -> persistent /home/agent
          -> persistent /var/lib/docker
          -> private nested dockerd
          -> project service containers
```

This is a Docker-based pseudo-VM: it provides a complete root Linux workstation and an independent Docker daemon, but it shares the host Linux kernel provided by Docker Desktop. It is not a hardware-virtualized VM.

The controller never mounts the host Docker socket into the workstation. Nested containers are children of the workstation's private daemon.
