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

## Native Computer Use tool path

```text
ChatGPT / agent
  -> Cloud Sandbox MCP V2 (controller)
     -> computer_use_* tools (first-party, opt-in)
        -> authenticated HTTPS-origin-scoped Mac host bridge (Docker Desktop gateway)
           -> macOS Automation / Accessibility / Screen Recording
              -> already-open Chrome or Microsoft Edge tabs
```

This path is distinct from `workspace_exec` and cannot leak bridge credentials into the Linux workstation. A native Mac dialog must approve each UI action. A separate passive user-session LaunchAgent is a transport component, not an autonomous planning agent; the MCP controller enforces the tool contract. The host bridge does not require raw CDP or a second Docker container.
