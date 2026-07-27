# Security model — Workstation mode

Workstation mode prioritizes agent autonomy inside a bounded environment.

## Granted inside each workstation

- root access;
- package installation;
- outbound network;
- nested Docker and Compose;
- browser execution;
- persistent CLI credentials under `/home/agent`;
- local databases, queues, and Kubernetes-in-Docker.

## Not granted

- host Docker socket;
- arbitrary host filesystem mounts;
- controller environment or secrets;
- direct GitHub token access used by `git_push`;
- access to other workspace directories.

A privileged container is not equivalent to a strong VM boundary. For untrusted code or production credentials, run the controller and workstations inside a dedicated VM or dedicated cloud host.
