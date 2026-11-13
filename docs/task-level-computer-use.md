# Delegación Mac por tarea — Sandbox V3

El procedimiento vigente está en [deploy/task-scoped/README.md](../deploy/task-scoped/README.md).

En trusted, el agente inicia automáticamente una sesión con task_id y orígenes HTTPS exactos al comienzo de una tarea autorizada, reutiliza session_id en CDP/nativo y revoca al finalizar. La sesión tiene máximo 30 minutos y 200 acciones. Una acción sin sesión en trusted falla con TASK_SESSION_REQUIRED, sin mostrar el cuadro por clic. La ausencia de trusted conserva el consentimiento local anterior.

Los cambios requieren desplegar el paquete y actualizar el descubrimiento de herramientas. El código fuente no demuestra instalación macOS; ver el recibo del paquete y el estado real del bridge.
